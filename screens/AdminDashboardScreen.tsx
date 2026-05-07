import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Switch, TextInput, Modal, ActivityIndicator, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Users, Settings, MapPin, Zap, BadgeCheck, Wine, X } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import { collection, query, where, getDocs } from 'firebase/firestore';
import Toast from 'react-native-toast-message';
import { firestore } from '../services/firebase';
import { useAppStore } from '../hooks/useAppStore';
import { grantCertificationBadge, revokeCertificationBadge } from '../services/achievementService';

export const AdminDashboardScreen = () => {
  const navigation = useNavigation<any>();
  const { isSimulationRunning, setIsSimulationRunning } = useAppStore();

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
