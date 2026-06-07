import React from 'react';
import { View, ActivityIndicator, Linking } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Toast from 'react-native-toast-message';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { toastConfig } from './config/toast';
import { MainTabs } from './navigation/MainTabs';
import { LoginScreen } from './screens/LoginScreen';
import { TermsScreen } from './screens/TermsScreen';
import { AchievementsScreen } from './screens/AchievementsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AdminSimulationScreen } from './screens/AdminSimulationScreen';
import { AdminDashboardScreen } from './screens/AdminDashboardScreen';
import { AdminUsersScreen } from './screens/AdminUsersScreen';
import { AdminReferralsScreen } from './screens/AdminReferralsScreen';
import { AdminReportsScreen } from './screens/AdminReportsScreen';
import { useAuth } from './hooks/useAuth';

import { useAppStore } from './hooks/useAppStore';
import { useSimulationEngine } from './hooks/useSimulationEngine';
import { useReferralTracker } from './hooks/useReferralTracker';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LiveVenuesProvider } from './contexts/LiveVenuesContext';

// Initialize Firebase (will be evaluated once)
import './services/firebase';

const Stack = createNativeStackNavigator();

export default function App() {
  // Bind Firebase auth listener to the app store
  useAuth();

  // Start serverless background engines
  useSimulationEngine();

  // Track creator referral installs on first open
  useReferralTracker();

  React.useEffect(() => {

    const handleUrl = async (url: string | null) => {
      if (!url) return;
      const inviteMatch = url.match(/\/invite\/([a-zA-Z0-9_-]+)/);
      if (inviteMatch && inviteMatch[1]) {
        const code = inviteMatch[1];
        // Firebase Auth UIDs are 28 characters. Creator referral codes are shorter.
        if (code.length === 28) {
          await AsyncStorage.setItem('referredBy', code);
        } else {
          await AsyncStorage.setItem('creatorReferralCode', code.toUpperCase().trim());
        }
      }
    };

    Linking.getInitialURL().then(handleUrl);
    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url));
    return () => subscription.remove();
  }, []);

  const { user, isLoading, hasAgreedToTerms } = useAppStore();

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FAFAFA' }}>
        <ActivityIndicator size="large" color="#000000" />
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <LiveVenuesProvider>
        <NavigationContainer theme={DarkTheme}>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#121212' },
              gestureEnabled: true,
            }}
          >
            {!user ? (
              <Stack.Screen name="Login" component={LoginScreen} />
            ) : !hasAgreedToTerms ? (
              <Stack.Screen name="OnboardingTerms" component={TermsScreen} />
            ) : (
              <>
                <Stack.Screen name="Main" component={MainTabs} />
                <Stack.Screen name="Terms" component={TermsScreen} />
                <Stack.Screen name="Achievements" component={AchievementsScreen} />
                <Stack.Screen name="Settings" component={SettingsScreen} />
                <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
                <Stack.Screen name="AdminSimulation" component={AdminSimulationScreen} />
                <Stack.Screen name="AdminUsers" component={AdminUsersScreen} />
                <Stack.Screen name="AdminReferrals" component={AdminReferralsScreen} />
                <Stack.Screen name="AdminReports" component={AdminReportsScreen} />
              </>
            )}
          </Stack.Navigator>

        </NavigationContainer>
      </LiveVenuesProvider>
      <Toast config={toastConfig} topOffset={60} />
    </ErrorBoundary>
  );
}
