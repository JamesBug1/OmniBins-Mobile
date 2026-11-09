import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  HomeIcon,
  CalendarIcon,
  ProfileIcon,
  MapIcon,
  AlertIcon
} from './Icons';

const PRIMARY_GREEN = '#00a63e';
const INACTIVE_COLOR = '#8e8e93';

const BottomNavbar = ({ currentScreen, onNavigate }) => {
  const insets = useSafeAreaInsets();

  // Updated order to match the reference image: Home, Schedule, Profile, Map, Report
  const navItems = [
    { id: 'Dashboard', label: 'Home', Icon: HomeIcon },
    { id: 'Schedule', label: 'Schedule', Icon: CalendarIcon },
    { id: 'Profile', label: 'Profile', Icon: ProfileIcon },
    { id: 'Map', label: 'Map', Icon: MapIcon },
    { id: 'Alerts', label: 'Report', Icon: AlertIcon },
  ];

  return (
    <View style={[styles.bottomNav, { height: 66 + insets.bottom, paddingBottom: insets.bottom }]}>
      {navItems.map((item) => {
        const isActive = currentScreen === item.id;
        return (
          <TouchableOpacity
            key={item.id}
            style={styles.navItem}
            onPress={() => onNavigate(item.id)}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={item.label}
          >
            <item.Icon
              size={24}
              color={isActive ? PRIMARY_GREEN : INACTIVE_COLOR}
            />
            <Text style={[
              styles.navText,
              isActive && styles.activeNavText
            ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
            >
              {item.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  bottomNav: {
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#f1f2f6',
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  navItem: {
    height: 66,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    paddingHorizontal: 2,
  },
  navText: {
    fontSize: 10,
    color: '#8e8e93',
    fontWeight: '500',
    marginTop: 3,
    textAlign: 'center',
  },
  activeNavText: {
    color: PRIMARY_GREEN,
    fontWeight: 'bold',
  },
});

export default BottomNavbar;
