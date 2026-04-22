import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, StatusBar, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Flame } from 'lucide-react-native';
import { useVenueDensity, VenueWithDensity } from '../hooks/useVenueDensity';

export const ListScreen = () => {
  const { venues, isLoading } = useVenueDensity();

  const renderItem = ({ item, index }: { item: VenueWithDensity; index: number }) => (
    <TouchableOpacity style={styles.venueCard} activeOpacity={0.8}>
      <View style={styles.rankBadge}>
        <Text style={styles.rankText}>#{index + 1}</Text>
      </View>

      <View style={styles.venueInfo}>
        <Text style={styles.venueName}>{item.name}</Text>
        <Text style={styles.venueDistance} numberOfLines={1}>{item.description}</Text>
      </View>

      <View style={[styles.activityBadge, { backgroundColor: `${item.activityColor}20`, borderColor: item.activityColor }]}>
        <Flame color={item.activityColor} size={14} />
        <Text style={[styles.activityText, { color: item.activityColor }]}>{item.activityLevel}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.title}>Live Rankings</Text>
        <Text style={styles.subtitle}>Where everyone's at right now</Text>
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#00FFCC" size="large" />
          <Text style={styles.loadingText}>Loading venues...</Text>
        </View>
      ) : (
        <FlatList
          data={venues}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
  },
  title: {
    fontSize: 32,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#A0A0A0',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 12,
  },
  venueCard: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  rankBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#252525',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  rankText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 16,
  },
  venueInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  venueName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  venueDistance: {
    color: '#888888',
    fontSize: 14,
  },
  activityBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
  },
  activityText: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    color: '#888888',
    fontSize: 14,
  },
  errorText: {
    color: '#FF0055',
    fontSize: 16,
    fontWeight: '600',
  },
});
