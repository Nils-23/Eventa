import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import { toastConfig } from './config/toast';
import { MainTabs } from './navigation/MainTabs';
import { LoginScreen } from './screens/LoginScreen';
import { AchievementsScreen } from './screens/AchievementsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AdminSimulationScreen } from './screens/AdminSimulationScreen';
import { AdminDashboardScreen } from './screens/AdminDashboardScreen';
import { useAuth } from './hooks/useAuth';
import { useAppStore } from './hooks/useAppStore';
import { useNotificationEngine } from './hooks/useNotificationEngine';
import { useSimulationEngine } from './hooks/useSimulationEngine';

// Initialize Firebase (will be evaluated once)
import './services/firebase';

const Stack = createNativeStackNavigator();

export default function App() {
  // Bind Firebase auth listener to the app store
  useAuth();
  
  // Start serverless background engines
  useNotificationEngine();
  useSimulationEngine();

  const { user, isLoading } = useAppStore();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAFAFA' }}>
        <ActivityIndicator size="large" color="#000000" />
      </View>
    );
  }

  return (
    <>
      <NavigationContainer theme={DarkTheme}>
        <Stack.Navigator
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: '#121212' },
          }}
        >
          {!user ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : (
            <>
              <Stack.Screen name="Main" component={MainTabs} />
              <Stack.Screen name="Achievements" component={AchievementsScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
              <Stack.Screen name="AdminSimulation" component={AdminSimulationScreen} />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>
      <Toast config={toastConfig} topOffset={60} />
    </>
  );
}
