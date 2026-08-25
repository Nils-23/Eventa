import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { Play, AlertTriangle, ImageOff, Maximize2 } from 'lucide-react-native';
import { doc, getDoc, collection, query, where, limit, getDocs } from 'firebase/firestore';
import { ref, get } from 'firebase/database';
import { firestore, realtimeDB } from '../services/firebase';
import { ReportData } from '../services/reportService';

export type MediaKind = 'image' | 'video';

/**
 * Firebase Storage URLs carry the filename inside an encoded path
 * (stories%2Fuid_123.mp4?alt=media&token=...), so the extension has to be read
 * from the decoded path, never from the raw string.
 */
const isHttpUrl = (value?: string | null): boolean =>
  !!value && /^https?:\/\//i.test(value.trim());

export const guessMediaKind = (url: string): MediaKind => {
  let path = url.split('?')[0];
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed escapes — fall back to the raw path.
  }
  return /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(path) ? 'video' : 'image';
};

const venueImageFor = (v: any): string | undefined =>
  v?.customImageUrl || v?.googlePhotoCdnUrl || v?.googleImageUrl || v?.img || v?.imageUrl || undefined;

const formatMoment = (value: any): string | undefined => {
  if (!value) return undefined;
  const date = value?.toDate ? value.toDate() : new Date(value);
  if (isNaN(date.getTime())) return undefined;
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

interface PreviewField {
  label: string;
  value: string;
}

interface Preview {
  /** Whether the reported item still exists in the live data. */
  exists: boolean;
  /** Explains what the admin is looking at when the live item is gone. */
  note?: string;
  authorName?: string;
  /** Resolved to a username at render time, so a late user-map load is picked up. */
  authorId?: string;
  text?: string;
  media?: { url: string; kind: MediaKind };
  /** Extra media shown as a strip (e.g. recent stories by a blocked user). */
  gallery?: { url: string; kind: MediaKind }[];
  fields?: PreviewField[];
}

interface ReportedContentPreviewProps {
  report: ReportData;
  userMap: Record<string, string>;
  onOpenMedia: (url: string, kind: MediaKind) => void;
}

/**
 * Resolves a report back to the content it points at and renders that content
 * inline. Reports only ever stored a `contentSnippet`, which for stories and
 * camera messages is a bare media URL — unverifiable in a moderation queue. So
 * every report is re-read from its source of truth (Firestore stories/venues/
 * users, RTDB chat) and rendered; the stored snippet is the fallback for when
 * the live item is already gone.
 */
export const ReportedContentPreview: React.FC<ReportedContentPreviewProps> = ({
  report,
  userMap,
  onOpenMedia,
}) => {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [mediaFailed, setMediaFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const snapshotFallback = (note: string): Preview => {
      const snippet = report.contentSnippet;
      // Newer reports store the media explicitly; older ones only ever put the
      // bare URL in the snippet, so both shapes have to be understood here.
      const captured = report.contentMediaUrl && isHttpUrl(report.contentMediaUrl)
        ? { url: report.contentMediaUrl, kind: (report.contentMediaType || guessMediaKind(report.contentMediaUrl)) as MediaKind }
        : isHttpUrl(snippet)
        ? { url: snippet.trim(), kind: guessMediaKind(snippet) }
        : undefined;

      return {
        exists: false,
        note,
        media: captured,
        text: captured
          ? undefined
          : snippet || '(No content text was captured with this report.)',
      };
    };

    const resolvePost = async (): Promise<Preview> => {
      const snap = await getDoc(doc(firestore, 'stories', report.contentId));
      if (!snap.exists()) {
        return snapshotFallback('This story no longer exists (deleted, or expired after 24h). Showing the media captured when it was reported.');
      }
      const data = snap.data() as any;
      const fields: PreviewField[] = [];
      const posted = formatMoment(data.created_at);
      if (posted) fields.push({ label: 'Posted', value: posted });
      if (data.venue_id) fields.push({ label: 'Venue', value: data.venue_id });
      return {
        exists: true,
        authorId: data.user_id,
        media: data.media_url
          ? { url: data.media_url, kind: data.media_type === 'video' ? 'video' : guessMediaKind(data.media_url) }
          : undefined,
        fields,
      };
    };

    const resolveChat = async (): Promise<Preview> => {
      if (!report.venueId) {
        return snapshotFallback('This report has no venue id, so the live message could not be located.');
      }
      const snap = await get(ref(realtimeDB, `venue_chats/${report.venueId}/${report.contentId}`));
      if (!snap.exists()) {
        return snapshotFallback('This message is no longer in the chat (deleted, or aged out). Showing what was captured when it was reported.');
      }
      const msg = snap.val() || {};
      const fields: PreviewField[] = [];
      const sent = formatMoment(msg.timestamp);
      if (sent) fields.push({ label: 'Sent', value: sent });
      if (msg.replyTo?.message) {
        fields.push({ label: 'In reply to', value: `${msg.replyTo.username}: ${msg.replyTo.message}` });
      }
      const isMedia = msg.type === 'media' && isHttpUrl(msg.message);
      return {
        exists: true,
        authorName: msg.username,
        authorId: msg.user_id,
        text: isMedia ? undefined : msg.message,
        media: isMedia
          ? { url: msg.message, kind: msg.mediaType === 'video' ? 'video' : guessMediaKind(msg.message) }
          : undefined,
        fields,
      };
    };

    const resolveVenue = async (): Promise<Preview> => {
      const snap = await getDoc(doc(firestore, 'venues', report.contentId));
      if (!snap.exists()) {
        return snapshotFallback('This venue/event listing no longer exists. Showing the name captured when it was reported.');
      }
      const data = snap.data() as any;
      const fields: PreviewField[] = [];
      if (data.type || data.category) fields.push({ label: 'Type', value: data.type || data.category });
      if (data.address) fields.push({ label: 'Address', value: data.address });
      if (data.venue) fields.push({ label: 'Host venue', value: data.venue });
      if (data.price) fields.push({ label: 'Price', value: String(data.price) });
      if (data.ticketLink) fields.push({ label: 'Ticket link', value: data.ticketLink });
      fields.push({ label: 'Currently', value: data.hidden ? 'Hidden from the map' : 'Visible on the map' });
      const image = venueImageFor(data);
      return {
        exists: true,
        authorName: data.name,
        text: data.description,
        media: image ? { url: image, kind: 'image' } : undefined,
        fields,
      };
    };

    const resolveUser = async (): Promise<Preview> => {
      if (!report.reportedUserId) {
        return snapshotFallback('This report has no reported user attached.');
      }
      const snap = await getDoc(doc(firestore, 'users', report.reportedUserId));
      if (!snap.exists()) {
        return snapshotFallback('This account no longer exists.');
      }
      const data = snap.data() as any;
      const fields: PreviewField[] = [];
      if (data.email) fields.push({ label: 'Email', value: data.email });
      fields.push({ label: 'Warnings', value: String(data.warnings || 0) });
      fields.push({ label: 'Account', value: data.suspended ? 'Suspended' : 'Active' });
      if (data.storyCount != null) fields.push({ label: 'Stories posted', value: String(data.storyCount) });

      // Their live stories are the only content the block itself points at, so
      // show them — a block report otherwise carries nothing to look at.
      let gallery: { url: string; kind: MediaKind }[] | undefined;
      try {
        const storiesSnap = await getDocs(
          query(collection(firestore, 'stories'), where('user_id', '==', report.reportedUserId), limit(9))
        );
        const items = storiesSnap.docs
          .map((d) => d.data() as any)
          .filter((s) => isHttpUrl(s.media_url))
          .map((s) => ({
            url: s.media_url as string,
            kind: (s.media_type === 'video' ? 'video' : guessMediaKind(s.media_url)) as MediaKind,
          }));
        if (items.length) gallery = items;
      } catch (error) {
        console.warn('Failed to load stories for reported user:', error);
      }

      return {
        exists: true,
        authorName: data.username || report.reportedUserId,
        text: data.bio,
        fields,
        gallery,
        note: gallery ? undefined : 'This user was blocked by the reporter; they have no live stories to review.',
      };
    };

    const run = async () => {
      setLoading(true);
      setMediaFailed(false);
      try {
        let result: Preview;
        switch (report.contentType) {
          case 'post':
            result = await resolvePost();
            break;
          case 'chat':
            result = await resolveChat();
            break;
          case 'venue':
            result = await resolveVenue();
            break;
          default:
            result = await resolveUser();
        }
        if (!cancelled) setPreview(result);
      } catch (error) {
        console.warn('Failed to resolve reported content:', error);
        if (!cancelled) {
          setPreview(snapshotFallback('Could not load the live content. Showing what was captured when it was reported.'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
    // userMap is deliberately not a dependency: it lands after the first render
    // and is only used for display, so re-resolving on it would refetch every
    // card for nothing.
  }, [report.id, report.contentMediaUrl, report.contentMediaType, report.contentId, report.contentType, report.venueId, report.reportedUserId]);

  if (loading) {
    return (
      <View style={[styles.box, styles.loadingBox]}>
        <ActivityIndicator color="#FF00CC" size="small" />
        <Text style={styles.loadingText}>Loading reported content…</Text>
      </View>
    );
  }

  if (!preview) return null;

  const authorLabel =
    preview.authorName ||
    (preview.authorId ? userMap[preview.authorId] || preview.authorId : undefined);

  const label =
    report.contentType === 'venue'
      ? 'REPORTED LISTING'
      : report.contentType === 'user_hidden'
      ? 'BLOCKED ACCOUNT'
      : report.contentType === 'chat'
      ? 'REPORTED MESSAGE'
      : 'REPORTED STORY';

  return (
    <View style={styles.box}>
      <View style={styles.boxHeader}>
        <Text style={styles.boxTitle}>{label}</Text>
        <View style={[styles.statusPill, preview.exists ? styles.statusLive : styles.statusGone]}>
          <Text style={[styles.statusText, preview.exists ? styles.statusTextLive : styles.statusTextGone]}>
            {preview.exists ? 'LIVE' : 'SNAPSHOT'}
          </Text>
        </View>
      </View>

      {authorLabel ? <Text style={styles.author}>{authorLabel}</Text> : null}

      {preview.media ? (
        mediaFailed ? (
          <View style={styles.mediaFailed}>
            <ImageOff color="#FF9900" size={20} />
            <Text style={styles.mediaFailedText}>
              Media could not be loaded — the file has most likely already been deleted.
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => preview.media && onOpenMedia(preview.media.url, preview.media.kind)}
          >
            <View style={styles.mediaWrapper}>
              {/* A video frame cannot be drawn by <Image>, so a clip gets a play
                  card rather than a thumbnail that would always fail to load. */}
              {preview.media.kind === 'video' ? (
                <View style={[styles.media, styles.videoPlaceholder]}>
                  <Play color="#FFF" size={34} fill="#FFF" />
                  <Text style={styles.videoPlaceholderText}>Tap to play the reported clip</Text>
                </View>
              ) : (
                <>
                  <Image
                    source={{ uri: preview.media.url }}
                    style={styles.media}
                    resizeMode="cover"
                    onError={() => setMediaFailed(true)}
                  />
                  <View style={styles.mediaOverlay}>
                    <Maximize2 color="#FFF" size={14} />
                    <Text style={styles.mediaOverlayText}>Tap to enlarge</Text>
                  </View>
                </>
              )}
            </View>
          </TouchableOpacity>
        )
      ) : null}

      {preview.text ? <Text style={styles.bodyText}>{preview.text}</Text> : null}

      {preview.gallery?.length ? (
        <View style={styles.gallery}>
          {preview.gallery.map((item) => (
            <TouchableOpacity key={item.url} onPress={() => onOpenMedia(item.url, item.kind)} activeOpacity={0.85}>
              <Image source={{ uri: item.url }} style={styles.galleryThumb} resizeMode="cover" />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}

      {preview.fields?.length ? (
        <View style={styles.fields}>
          {preview.fields.map((field) => (
            <Text key={field.label} style={styles.fieldLabel} numberOfLines={2}>
              {field.label}: <Text style={styles.fieldValue}>{field.value}</Text>
            </Text>
          ))}
        </View>
      ) : null}

      {preview.note ? (
        <View style={styles.note}>
          <AlertTriangle color="#FF9900" size={14} />
          <Text style={styles.noteText}>{preview.note}</Text>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  box: {
    backgroundColor: '#121212',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#222',
    gap: 8,
  },
  loadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadingText: {
    color: '#888',
    fontSize: 12,
  },
  boxHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  boxTitle: {
    color: '#FF00CC',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statusPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusLive: {
    backgroundColor: 'rgba(0, 255, 204, 0.12)',
  },
  statusGone: {
    backgroundColor: 'rgba(255, 153, 0, 0.12)',
  },
  statusText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statusTextLive: {
    color: '#00FFCC',
  },
  statusTextGone: {
    color: '#FF9900',
  },
  author: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  mediaWrapper: {
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  media: {
    width: '100%',
    height: 200,
  },
  mediaOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  mediaOverlayText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '600',
  },
  videoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1E1E1E',
  },
  videoPlaceholderText: {
    color: '#AAA',
    fontSize: 12,
    fontWeight: '600',
  },
  mediaFailed: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 153, 0, 0.08)',
    padding: 10,
    borderRadius: 8,
  },
  mediaFailedText: {
    color: '#FF9900',
    fontSize: 12,
    flex: 1,
  },
  bodyText: {
    color: '#EEE',
    fontSize: 14,
    lineHeight: 20,
  },
  gallery: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  galleryThumb: {
    width: 64,
    height: 64,
    borderRadius: 6,
    backgroundColor: '#000',
  },
  fields: {
    gap: 3,
  },
  fieldLabel: {
    color: '#777',
    fontSize: 12,
  },
  fieldValue: {
    color: '#CCC',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  noteText: {
    color: '#FF9900',
    fontSize: 11,
    flex: 1,
    lineHeight: 15,
  },
});
