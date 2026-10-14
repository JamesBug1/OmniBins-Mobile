import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, SafeAreaView, Image, ActivityIndicator, Alert } from 'react-native';
import { signInAndAuthorize, registerDeviceTokenForCurrentUser } from '../firebaseConfig';

const PRIMARY_GREEN = '#00a63e';

const LoginPage = ({ onLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const getFriendlyLoginError = (message = '') => {
    const msg = String(message || '').toLowerCase();

    if (!msg) return 'Login failed. Please try again.';
    if (msg.includes('invalid-email') || msg.includes('email is invalid')) return 'Please enter a valid email address.';
    if (msg.includes('user-not-found') || msg.includes('no user records found')) return 'No account was found for this email.';
    if (msg.includes('wrong-password') || msg.includes('password')) return 'Incorrect password. Please try again.';
    if (msg.includes('account is pending approval')) return 'Your account is pending approval. Please contact an administrator.';
    if (msg.includes('account not authorized') || msg.includes('only staff accounts')) return 'This account is not authorized for OmniBins staff access.';
    if (msg.includes('too-many-requests')) return 'Too many attempts. Please wait a moment and try again.';
    if (msg.includes('network')) return 'Network error. Please check your connection and try again.';
    if (msg.includes('email not verified')) return 'Please verify your email before logging in.';
    return 'Login failed. Please check your email and password.';
  };

  const handlePress = async () => {
    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail || !trimmedPassword) {
      const message = !trimmedEmail && !trimmedPassword
        ? 'Please enter your email and password.'
        : !trimmedEmail
          ? 'Please enter your email.'
          : 'Please enter your password.';
      setError(message);
      Alert.alert('Missing information', message);
      return;
    }

    setError('');
    setLoading(true);
    try {
      const result = await signInAndAuthorize(trimmedEmail, password);
      if (result?.userId) {
        try {
          await registerDeviceTokenForCurrentUser(result.userId);
        } catch (notificationError) {
          console.warn('Notification token registration failed after login', notificationError);
        }
      }
      setLoading(false);
      onLogin();
    } catch (e) {
      setLoading(false);
      const msg = getFriendlyLoginError(e?.message || 'Login failed');
      setError(msg);
      Alert.alert('Login error', msg);
    }
  };

  return (
    <SafeAreaView style={styles.loginContainer}>
      <View style={styles.LoginLogo}>
        <Image
          source={require('../assets/omni.png')}
          style={styles.logoImage}
        />
      </View>
      <Text style={styles.headerTitle}>OMNIBINS</Text>
      <Text style={styles.subTitle}>Please sign in to continue</Text>

      <TextInput
        style={styles.input}
        placeholder="Email Address"
        keyboardType="email-address"
        autoCapitalize="none"
        placeholderTextColor="#000000"
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          if (error) setError('');
        }}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry={true}
        placeholderTextColor="#000000"
        value={password}
        onChangeText={(text) => {
          setPassword(text);
          if (error) setError('');
        }}
      />

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <TouchableOpacity style={styles.loginButton} onPress={handlePress} disabled={loading}>
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.loginButtonText}>Login</Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  loginContainer: {
    flex: 1,
    backgroundColor: '#f9fafb',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 30,
  },
  LoginLogo: {
    width: 190,
    height: 190,
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

  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#0c0c0c',
    marginBottom: 5,
    textAlign: 'center',
  },
  subTitle: {
    fontSize: 16,
    color: '#7f8fa6',
    marginBottom: 40,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#f6f6f2',
    color: '#000000',
    padding: 15,
    borderRadius: 10,
    marginBottom: 15,
    fontSize: 16,
    borderWidth: 2,
    borderColor: '#191a1c',
    width: '100%',
  },
  errorText: {
    width: '100%',
    color: '#d93025',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'left',
  },
  loginButton: {
    backgroundColor: PRIMARY_GREEN,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 10,
    width: '100%',
  },
  loginButtonText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
  },
});

export default LoginPage;
