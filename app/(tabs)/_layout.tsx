import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet } from 'react-native';
import { useTheme } from '../../src/contexts/ThemeContext';

export default function TabLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.textSecondary,
        tabBarStyle: [styles.tabBar, { backgroundColor: t.tabBar, borderTopColor: t.border }],
        tabBarLabelStyle: styles.tabLabel,
        headerStyle: { backgroundColor: t.surface },
        headerTitleStyle: { fontWeight: '700', color: t.text },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'My Spots',
          tabBarLabel: 'Spots',
          tabBarIcon: ({ color, size }) => <Ionicons name="bookmark" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color, size }) => <Ionicons name="map" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle" size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    paddingBottom: Platform.OS === 'ios' ? 20 : 8,
    paddingTop: 8,
    height: Platform.OS === 'ios' ? 85 : 65,
  },
  tabLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
});
