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
import { OnboardingScreen } from './screens/OnboardingScreen';
import { AchievementsScreen } from './screens/AchievementsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { AdminSimulationScreen } from './screens/AdminSimulationScreen';
import { AdminDashboardScreen } from './screens/AdminDashboardScreen';
import { AdminUsersScreen } from './screens/AdminUsersScreen';
import { AdminReferralsScreen } from './screens/AdminReferralsScreen';
import { AdminReportsScreen } from './screens/AdminReportsScreen';
import { AdminAICuratorScreen } from './screens/AdminAICuratorScreen';
import { EventDetailScreen } from './screens/EventDetailScreen';
import { useAuth } from './hooks/useAuth';

import { useAppStore } from './hooks/useAppStore';
import { useSimulationEngine } from './hooks/useSimulationEngine';
import { useReferralTracker } from './hooks/useReferralTracker';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LiveVenuesProvider } from './contexts/LiveVenuesContext';
import { useVersionCheck } from './hooks/useVersionCheck';
import { UpdatePromptModal } from './components/UpdatePromptModal';


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

  // Check for app updates
  const versionInfo = useVersionCheck();
  const [hasDismissedFlexibleUpdate, setHasDismissedFlexibleUpdate] = React.useState(false);

  // First Launch Onboarding State
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    AsyncStorage.getItem('eventas_has_completed_onboarding').then(val => {
      setHasCompletedOnboarding(val === 'true');
    });
  }, []);


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

  const user = useAppStore((s) => s.user);
  const isLoading = useAppStore((s) => s.isLoading);
  const hasAgreedToTerms = useAppStore((s) => s.hasAgreedToTerms);

  if (isLoading || hasCompletedOnboarding === null) {
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
              fullScreenGestureEnabled: true,
            }}
          >
            {!hasCompletedOnboarding ? (
              <Stack.Screen name="Onboarding">
                {props => (
                  <OnboardingScreen
                    {...props}
                    onComplete={async () => {
                      await AsyncStorage.setItem('eventas_has_completed_onboarding', 'true');
                      setHasCompletedOnboarding(true);
                    }}
                  />
                )}
              </Stack.Screen>
            ) : !user ? (
              <>
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="Terms" component={TermsScreen} />
              </>
            ) : !hasAgreedToTerms ? (
              <Stack.Screen name="OnboardingTerms" component={TermsScreen} />
            ) : (
              <>
                <Stack.Screen name="Main" component={MainTabs} />
                <Stack.Screen name="EventDetail" component={EventDetailScreen} />
                <Stack.Screen name="Terms" component={TermsScreen} />
                <Stack.Screen name="Achievements" component={AchievementsScreen} />
                <Stack.Screen name="Settings" component={SettingsScreen} />
                <Stack.Screen name="AdminDashboard" component={AdminDashboardScreen} />
                <Stack.Screen name="AdminSimulation" component={AdminSimulationScreen} />
                <Stack.Screen name="AdminUsers" component={AdminUsersScreen} />
                <Stack.Screen name="AdminReferrals" component={AdminReferralsScreen} />
                <Stack.Screen name="AdminReports" component={AdminReportsScreen} />
                <Stack.Screen name="AdminAICurator" component={AdminAICuratorScreen} />
              </>
            )}
          </Stack.Navigator>

        </NavigationContainer>
      </LiveVenuesProvider>
      <UpdatePromptModal
        isVisible={versionInfo.showPrompt && (versionInfo.isForced || !hasDismissedFlexibleUpdate)}
        isForced={versionInfo.isForced}
        latestVersion={versionInfo.latestVersion}
        updateUrl={versionInfo.updateUrl}
        onClose={() => setHasDismissedFlexibleUpdate(true)}
      />
      <Toast config={toastConfig} topOffset={60} />
    </ErrorBoundary>
  );
}
