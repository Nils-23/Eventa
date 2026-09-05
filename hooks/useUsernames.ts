import { useEffect, useMemo, useRef, useState } from 'react';
import { getCachedUsername, subscribeUsername } from '../services/userService';

/**
 * Live display names for a set of user ids.
 *
 * Every surface that shows somebody's name should resolve it through this hook
 * rather than reading the copy that was denormalised onto the message, story or
 * review when it was written. Those copies are frozen at write time, so before
 * this existed a rename reached the profile screen and nothing else — the user
 * kept appearing under the auto-generated name they were handed at sign-up.
 *
 * One listener per distinct id, shared process-wide, torn down when the last
 * consumer unmounts. Renders synchronously from cache when the name is already
 * known, so a list does not flash the stale name on its first frame.
 */
export const useUsernames = (userIds: (string | undefined | null)[]): Record<string, string> => {
  // The id list is rebuilt on every render by its callers (it is derived from a
  // message array); collapsing it to a sorted key keeps the effect from
  // resubscribing on every keystroke in the chat input.
  const key = useMemo(() => {
    const unique = Array.from(new Set(userIds.filter((id): id is string => !!id)));
    unique.sort();
    return unique.join('|');
  }, [userIds]);

  const [names, setNames] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    key.split('|').filter(Boolean).forEach((id) => {
      const cached = getCachedUsername(id);
      if (cached) seed[id] = cached;
    });
    return seed;
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const ids = key.split('|').filter(Boolean);
    if (ids.length === 0) return;

    const unsubs = ids.map((id) =>
      subscribeUsername(id, (name) => {
        if (!mounted.current) return;
        setNames((prev) => (prev[id] === name ? prev : { ...prev, [id]: name }));
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [key]);

  return names;
};

/** Single-user convenience wrapper. Returns null until a name is known. */
export const useUsername = (userId?: string | null): string | null => {
  const ids = useMemo(() => [userId], [userId]);
  const names = useUsernames(ids);
  return userId ? names[userId] ?? null : null;
};
