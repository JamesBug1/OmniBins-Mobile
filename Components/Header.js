import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { NotificationIcon } from './Icons';
import { auth, registerDeviceTokenForCurrentUser } from '../firebaseConfig';

const PRIMARY_GREEN = '#00a63e';

const Header = ({ title }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [badgeCount, setBadgeCount] = useState(0);

  const handleNotificationPress = async () => {
    const currentUser = auth?.currentUser;

    if (!currentUser) {
      Alert.alert('Not signed in', 'Sign in to enable notifications for your account.');
      return;
    }

    try {
      setIsRegistering(true);
      const token = await registerDeviceTokenForCurrentUser(currentUser.uid);

      if (token) {
        setBadgeCount(1);
        Alert.alert('Notifications enabled', 'You will now receive important updates.');
      } else {
        setBadgeCount(0);
        Alert.alert('Notifications unavailable', 'Allow notifications in your phone settings, then try again.');
      }
    } catch (e) {
      setBadgeCount(0);
      Alert.alert('Notification error', e?.message || 'Unable to enable notifications right now.');
    } finally {
      setIsRegistering(false);
    }
  };

  return (
    <View style={styles.header}>
      {/* Invisible spacer to keep the title centered now that menu is removed */}
      <View style={styles.spacer} />

      <Text style={styles.headerTitle}>{title}</Text>

      <TouchableOpacity style={styles.iconButton} onPress={handleNotificationPress} disabled={isRegistering} activeOpacity={0.8}>
        <NotificationIcon size={32} color="#ffffff" badgeCount={badgeCount} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: PRIMARY_GREEN,
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    zIndex: 100,


  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    flex: 1,
  },
  iconButton: {
    padding: 5,
    width: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: {
    width: 50,
  },
});

export default Header;
