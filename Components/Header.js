import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NotificationIcon } from './Icons';

const PRIMARY_GREEN = '#00a63e';

const Header = ({ title }) => {
  return (
    <View style={styles.header}>
      {/* Invisible spacer to keep the title centered now that menu is removed */}
      <View style={styles.spacer} />

      <Text style={styles.headerTitle}>{title}</Text>

      <TouchableOpacity style={styles.iconButton}>
        <NotificationIcon size={32} color="#ffffff" badgeCount={3} />
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
