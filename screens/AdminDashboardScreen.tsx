import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, TextInput, Modal, ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Users, Settings, MapPin, Zap, BadgeCheck, Wine, X, Activity } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, query, where, getDocs } from 'firebase/firestore';
import Toast from 'react-native-toast-message';
import { firestore, realtimeDB } from '../services/firebase';
import { ref, onValue } from 'firebase/database';
import { useAppStore } from '../hooks/useAppStore';
import { grantCertificationBadge, revokeCertificationBadge } from '../services/achievementService';

export const AdminDashboardScreen = () => {
  const navigation = useNavigation<any>();
  const { isSimulationRunning, setIsSimulationRunning } = useAppStore();
  const [liveUserCount, setLiveUserCount] = useState<number>(0);

  useEffect(() => {
    const STALE_MS = 2 * 60 * 60 * 1000; // 2 hours
    const unsub = onValue(ref(realtimeDB, 'locations'), (snap) => {
      if (snap.exists()) {
        const locations = snap.val();
        const now = Date.now();
        const count = Object.values(locations).filter(
          (loc: any) => loc.latitude && loc.longitude && (now - loc.timestamp < STALE_MS)
        ).length;
        setLiveUserCount(count);
      } else {
        setLiveUserCount(0);
      }
    });

    return () => unsub();
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <ArrowLeft color="#FFFFFF" size={24} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Admin Dashboard</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.welcomeText}>Welcome to the Admin Hub</Text>
        <Text style={styles.subtitle}>Select a module to manage platform operations.</Text>

        <View style={styles.grid}>
          {/* Live Stats Card */}
          <View style={[styles.card, styles.statsCard]}>
            <View style={styles.statsHeader}>
              <View style={styles.liveIndicator}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>LIVE</Text>
              </View>
              <Activity color="#00FFCC" size={24} />
            </View>
            <View style={styles.statsContent}>
              <Text style={styles.statsCount}>{liveUserCount}</Text>
              <Text style={styles.statsLabel}>Real Users Active</Text>
            </View>
          </View>

          {/* Venue & Simulation Management */}
          <TouchableOpacity 
            style={styles.card} 
            onPress={() => navigation.navigate('AdminSimulation')}
          >
            <View style={styles.iconContainer}>
              <Users color="#FF00CC" size={32} />
              <MapPin color="#00FFCC" size={24} style={styles.subIcon} />
            </View>
            <Text style={styles.cardTitle}>Venue & Users</Text>
            <Text style={styles.cardDesc}>Manage venues, add new locations, and control simulated user counts.</Text>
          </TouchableOpacity>

          {/* Master Simulation Toggle */}
          <View style={[styles.card, styles.toggleCard]}>
            <View style={{ flex: 1 }}>
              <View style={styles.toggleHeader}>
                <Zap color={isSimulationRunning ? "#FF00CC" : "#888"} size={20} />
                <Text style={styles.cardTitle}>Simulation Engine</Text>
              </View>
              <Text style={styles.cardDesc}>
                {isSimulationRunning 
                  ? "Running in background. Fake locations are actively syncing to the map."
                  : "Engine is paused. Toggle to start simulating activity locally."}
              </Text>
            </View>
            <Switch
              value={isSimulationRunning}
              onValueChange={setIsSimulationRunning}
              trackColor={{ false: '#222', true: '#FF00CC' }}
              thumbColor={isSimulationRunning ? '#FFFFFF' : '#888'}
            />
          </View>

          {/* Certification & Bottle Awards */}
          <TouchableOpacity 
            style={styles.card} 
            onPress={() => navigation.navigate('AdminUsers')}
          >
            <View style={styles.iconContainer}>
              <BadgeCheck color="#FFD700" size={28} />
              <Wine color="#D4A843" size={20} style={styles.subIcon} />
            </View>
            <Text style={styles.cardTitle}>Users & Awards</Text>
            <Text style={styles.cardDesc}>Grant the prestige certification badge and monthly Nightlife Legend bottle reward to top-tier users.</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#2A2A2A',
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    padding: 24,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888',
    marginBottom: 32,
  },
  grid: {
    flexDirection: 'column',
    gap: 16,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#333',
  },
  statsCard: {
    borderColor: 'rgba(0, 255, 204, 0.3)',
    backgroundColor: 'rgba(0, 255, 204, 0.05)',
  },
  statsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 0, 85, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 6,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF0055',
  },
  liveText: {
    color: '#FF0055',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statsContent: {
    alignItems: 'center',
  },
  statsCount: {
    fontSize: 48,
    fontWeight: '800',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  statsLabel: {
    fontSize: 14,
    color: '#00FFCC',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  cardDisabled: {
    backgroundColor: '#161616',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#222',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 0, 204, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    position: 'relative',
  },
  subIcon: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    backgroundColor: '#1A1A1A',
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  cardDesc: {
    color: '#888',
    fontSize: 14,
    lineHeight: 20,
  },
});
