import React, { useEffect } from 'react';
import { View, StyleSheet, Image, StatusBar } from 'react-native';

const LoadingScreen = ({ onFinish }) => {
  useEffect(() => {
    // 1.5 second delay
    const timer = setTimeout(() => {
      onFinish();
    }, 1500);

    return () => clearTimeout(timer);
  }, [onFinish]);

  return (
    <View style={styles.splashContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="#f9fafb" />

      <View style={styles.contentContainer}>
        {/* Logo Section */}
        <View style={styles.logoCircle}>
          <Image
            source={require('../assets/omni.png')}
            style={styles.logoImage}
          />
        </View>

      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: '#f9fafb',
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoCircle: {
    width: 180,
    height: 180,
    backgroundColor: '#ffffff',
    borderRadius: 90,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 12,
  },
  logoImage: {
    width: 130,
    height: 130,
    resizeMode: 'contain',
    }
});

export default LoadingScreen;
