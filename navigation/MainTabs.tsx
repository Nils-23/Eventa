import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { MapScreen } from '../screens/MapScreen';
import { ListScreen } from '../screens/ListScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { Map, List, User } from 'lucide-react-native';
import { useLocationTracking } from '../hooks/useLocationTracking';
import { usePushNotifications } from '../hooks/usePushNotifications';

const Tab = createBottomTabNavigator();

export const MainTabs = () => {
  // Mount the global location tracking. Will only sync when App state is active.
  useLocationTracking();
  // Register for push notifications and sync token
  usePushNotifications();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#121212',
          borderTopWidth: 1,
          borderTopColor: '#2A2A2A',
          height: 85,
          paddingBottom: 25,
          paddingTop: 10,
        },
        tabBarActiveTintColor: '#00FFCC', // Neon vibe
        tabBarInactiveTintColor: '#666666',
        tabBarShowLabel: true,
        tabBarLabelStyle: {
          fontSize: 12,
          fontWeight: '600',
        },
      }}
    >
      <Tab.Screen 
        name="Map" 
        component={MapScreen}
        options={{
          tabBarIcon: ({ color, size }) => <Map color={color} size={size} />,
        }}
      />
      <Tab.Screen 
        name="List" 
        component={ListScreen}
        options={{
          tabBarIcon: ({ color, size }) => <List color={color} size={size} />,
        }}
      />
      <Tab.Screen 
        name="Profile" 
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color, size }) => <User color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
};
