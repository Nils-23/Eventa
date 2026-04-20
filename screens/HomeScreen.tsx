import React from 'react';
import { View, Text, StyleSheet, SafeAreaView, TouchableOpacity } from 'react-native';
import { useAppStore } from '../hooks/useAppStore';

export const HomeScreen = () => {
  const { hasInitialized, setInitialized } = useAppStore();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Welcome to Eventa Ant</Text>
        <Text style={styles.subtitle}>
          Your React Native application is ready.
        </Text>
        
        <View style={styles.statusCard}>
          <Text style={styles.statusLabel}>Zustand State:</Text>
          <Text style={styles.statusValue}>
            Initialized: {hasInitialized ? 'Yes' : 'No'}
          </Text>
        </View>

        <TouchableOpacity 
          style={styles.button}
          onPress={() => setInitialized(!hasInitialized)}
        >
          <Text style={styles.buttonText}>Toggle State</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAFAFA',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666666',
    marginBottom: 32,
    textAlign: 'center',
  },
  statusCard: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderRadius: 12,
    width: '100%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    marginBottom: 24,
  },
  statusLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333333',
    marginBottom: 4,
  },
  statusValue: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '500',
  },
  button: {
    backgroundColor: '#007AFF',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 30,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
