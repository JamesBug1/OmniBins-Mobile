import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Alert,
  Switch,
  Platform,
  PermissionsAndroid,
  Linking,
} from 'react-native';
import { ChevronRightIcon } from '../Components/Icons';
import app, { signOutUser, auth, db } from '../firebaseConfig';
import { ref, get, update } from 'firebase/database';
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword, updateEmail, sendEmailVerification, reload } from 'firebase/auth';

const PRIMARY_GREEN = '#00a63e';

const ProfilePage = ({ onLogout }) => {
  const [userRecord, setUserRecord] = useState(null);
  const [loading, setLoading] = useState(true);

  const [editingField, setEditingField] = useState(null); // 'phone'|'email'|'employeeId'
  const [editValue, setEditValue] = useState('');

  const [reauthModalVisible, setReauthModalVisible] = useState(false);
  const [reauthPassword, setReauthPassword] = useState('');
  const [reauthLoading, setReauthLoading] = useState(false);

  const [verificationPending, setVerificationPending] = useState(false);
  const [pendingEmail, setPendingEmail] = useState('');
  const verifyIntervalRef = useRef(null);
  const verifyAttemptsRef = useRef(0);

  const [showPassModal, setShowPassModal] = useState(false);
  const [currentPass, setCurrentPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [profileImageUri, setProfileImageUri] = useState(null);
  const [uploadingProfileImage, setUploadingProfileImage] = useState(false);
  const [allowNotifications, setAllowNotifications] = useState(false);
  const [allowLocation, setAllowLocation] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const current = auth?.currentUser;
        if (!current) {
          if (mounted) setLoading(false);
          return;
        }

        const emailLower = (current.email || '').toLowerCase();
        const usersSnap = await get(ref(db, 'users'));
        const users = usersSnap.val();
        if (!users) {
          if (mounted) setLoading(false);
          return;
        }

        const match = Object.entries(users).find(([, value]) => {
          if (!value || typeof value !== 'object') return false;
          const userEmail = (value.email || '').toLowerCase();
          return userEmail === emailLower;
        });

        if (match && mounted) {
          const [id, rec] = match;
          const nextUser = { id, ...rec };
          setUserRecord(nextUser);
          setAllowNotifications(!!nextUser.allowNotifications);
          setAllowLocation(!!nextUser.allowLocation);
          setEditValue('');
        }
      } catch (e) {
        console.warn('Failed to load profile', e?.message || e);
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => { mounted = false; };
  }, []);

  // individual-field saves handled in the field edit modal's Save button

  const pickProfileImage = async () => {
    try {
      const picker = require('react-native-image-picker');
      const options = {
        mediaType: 'photo',
        quality: 0.8,
        allowsEditing: true,
      };

      picker.launchImageLibrary(options, async (response) => {
        if (!response || response.didCancel) return;
        if (response.errorCode) {
          Alert.alert('Image error', response.errorMessage || 'Unable to choose image');
          return;
        }

        const asset = response.assets && response.assets[0];
        if (asset && asset.uri) {
          setProfileImageUri(asset.uri);
          try {
            const storage = getStorage(app);
            const blob = await fetch(asset.uri).then(res => res.blob());
            const fileName = `profile_pictures/${auth.currentUser.uid}.jpg`;
            const picRef = storageRef(storage, fileName);
            await uploadBytes(picRef, blob);
            const imageUrl = await getDownloadURL(picRef);
            await update(ref(db, `users/${userRecord.id}`), { profilePicUrl: imageUrl });
            setUserRecord(prev => ({ ...(prev || {}), profilePicUrl: imageUrl }));
            Alert.alert('Success', 'Profile picture updated');
          } catch (e) {
            console.warn('Profile image upload failed', e?.message || e);
            Alert.alert('Upload failed', e?.message || 'Could not upload profile picture');
          }
        }
      });
    } catch (e) {
      Alert.alert('Image Picker Missing', 'Please install react-native-image-picker and rebuild the app.');
    }
  };

  const persistPreference = async (key, value) => {
    if (!userRecord?.id) return;
    try {
      await update(ref(db, `users/${userRecord.id}`), { [key]: value });
      setUserRecord(prev => ({ ...(prev || {}), [key]: value }));
    } catch (e) {
      console.warn(`Failed to save ${key}`, e);
      Alert.alert('Save failed', e?.message || `Could not save ${key}`);
    }
  };

  const requestNotificationPermission = async () => {
    if (Platform.OS === 'android') {
      if (Number(Platform.Version) < 33) {
        await persistPreference('allowNotifications', true);
        setAllowNotifications(true);
        return;
      }

      try {
        const result = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
        const granted = result === PermissionsAndroid.RESULTS.GRANTED;
        await persistPreference('allowNotifications', granted);
        setAllowNotifications(granted);
        if (!granted) {
          Alert.alert('Notifications blocked', 'Enable notifications in your phone settings to receive updates.');
        }
      } catch (e) {
        console.warn('Notification permission request failed', e);
        Alert.alert('Permission error', e?.message || 'Unable to request notification permission');
      }
      return;
    }

    // iOS requires native settings, so we keep the toggle state in the app and prompt the user to enable it manually.
    await persistPreference('allowNotifications', true);
    setAllowNotifications(true);
    Alert.alert('Notification permission', 'Please enable notifications for OmniBins in your iPhone Settings.');
    Linking.openSettings();
  };

  const requestLocationPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        );
        const finalValue = granted === PermissionsAndroid.RESULTS.GRANTED;
        await persistPreference('allowLocation', finalValue);
        setAllowLocation(finalValue);
        if (!finalValue) {
          Alert.alert('Location blocked', 'Enable location access in your phone settings for the map and route features.');
        }
      } catch (e) {
        console.warn('Location permission request failed', e);
        Alert.alert('Permission error', e?.message || 'Unable to request location permission');
      }
      return;
    }

    await persistPreference('allowLocation', true);
    setAllowLocation(true);
    Alert.alert('Location permission', 'Please enable location access for OmniBins in your iPhone Settings.');
    Linking.openSettings();
  };

  const handleChangePassword = async () => {
    if (!auth.currentUser) {
      Alert.alert('Error', 'No authenticated user');
      return;
    }
    if (!currentPass || !newPass) {
      Alert.alert('Error', 'Enter both current and new password');
      return;
    }

    setChangingPassword(true);
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, currentPass);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, newPass);
      setShowPassModal(false);
      setCurrentPass('');
      setNewPass('');
      Alert.alert('Success', 'Password changed');
    } catch (e) {
      console.warn('Password change failed', e);
      Alert.alert('Error', e?.message || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  // 2FA removed

  const handleReauthAndRetryEmail = async (pendingEmail) => {
    if (!auth.currentUser) return;
    setReauthLoading(true);
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, reauthPassword);
      await reauthenticateWithCredential(auth.currentUser, cred);
      // retry updateEmail
      try {
        await updateEmail(auth.currentUser, pendingEmail);
      } catch (e) {
        const msg = e?.message || '';
        const needsVerifyBeforeChange = /verify.*new email|please verify the new email/i.test(msg);
        if (needsVerifyBeforeChange) {
          Alert.alert(
            'Verification Required',
            'The backend requires the new email to be verified before changing it. This typically requires a server-side verify-before-change flow (Cloud Function). You can also try reauthenticating and retrying.',
            [
              { text: 'Reauthenticate', onPress: () => setReauthModalVisible(true) },
              { text: 'OK', style: 'cancel' },
            ],
          );
          setReauthModalVisible(false);
          setReauthPassword('');
          setReauthLoading(false);
          return;
        }
        throw e;
      }
      // send verification to the new email
      try { await sendEmailVerification(auth.currentUser); } catch (e) { console.warn('sendEmailVerification failed', e); }
      // write pending change to DB; finalize after user verifies
      await update(ref(db, `users/${userRecord.id}`), { pendingEmail: pendingEmail, emailVerified: false });
      setPendingEmail(pendingEmail);
      setVerificationPending(true);
      // start auto-checking for verification
      startVerificationWatcher();
      setEditingField(null);
      setEditValue('');
      setReauthModalVisible(false);
      setReauthPassword('');
      Alert.alert('Verification Sent', 'A verification link was sent to the new address. Please verify to finalize the change.');
    } catch (e) {
      console.warn('Reauth/email retry failed', e);
      Alert.alert('Error', e?.message || 'Reauthentication failed');
    } finally {
      setReauthLoading(false);
    }
  };

  const checkEmailVerification = async () => {
    if (!auth.currentUser) return;
    try {
      await reload(auth.currentUser);
      const verified = !!auth.currentUser.emailVerified;
      const currentEmail = auth.currentUser.email || '';
      if (verified && currentEmail === pendingEmail) {
        // move pendingEmail into official email field
        await update(ref(db, `users/${userRecord.id}`), { email: pendingEmail, pendingEmail: null, emailVerified: true });
        setUserRecord(prev => ({ ...(prev||{}), email: pendingEmail, pendingEmail: null, emailVerified: true }));
        setVerificationPending(false);
        setPendingEmail('');
        Alert.alert('Saved', 'Email verified and updated');
        // clear interval if running
        if (verifyIntervalRef.current) { clearInterval(verifyIntervalRef.current); verifyIntervalRef.current = null; }
        verifyAttemptsRef.current = 0;
        return true;
      } else {
        Alert.alert('Not Verified', 'We could not verify the email yet. Make sure you clicked the link in the new email.');
        return false;
      }
    } catch (e) {
      console.warn('checkEmailVerification failed', e);
      Alert.alert('Error', e?.message || 'Failed to check verification');
      return false;
    }
  };

  const startVerificationWatcher = () => {
    // clear existing
    if (verifyIntervalRef.current) {
      clearInterval(verifyIntervalRef.current);
      verifyIntervalRef.current = null;
    }
    verifyAttemptsRef.current = 0;
    verifyIntervalRef.current = setInterval(async () => {
      verifyAttemptsRef.current += 1;
      const ok = await checkEmailVerification();
      if (ok) {
        // verified and cleared inside checkEmailVerification
        return;
      }
      if (verifyAttemptsRef.current >= 12) { // ~1 minute
        clearInterval(verifyIntervalRef.current);
        verifyIntervalRef.current = null;
        verifyAttemptsRef.current = 0;
        Alert.alert('Still not verified', 'We did not detect verification yet. Please check your email and try the "I verified" button.');
      }
    }, 5000);
  };

  useEffect(() => {
    return () => {
      if (verifyIntervalRef.current) { clearInterval(verifyIntervalRef.current); verifyIntervalRef.current = null; }
    };
  }, []);

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <View style={styles.profileCard}>
          <View style={styles.avatarWrapper}>
            <Image
              source={
                userRecord?.profilePicUrl
                  ? { uri: userRecord.profilePicUrl }
                  : require('../assets/logo_bg.png')
              }
              style={styles.avatar}
            />
            <TouchableOpacity style={styles.cameraBtn} onPress={pickProfileImage}>
              <Text style={styles.cameraIcon}>{uploadingProfileImage ? '…' : '📷'}</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.profileInfo}>
            {loading ? (
              <ActivityIndicator size="small" color={PRIMARY_GREEN} />
            ) : (
              <>
                <Text style={styles.profileName}>{userRecord?.name || auth?.currentUser?.displayName || 'Unnamed'}</Text>
                <Text style={styles.profileRole}>{userRecord?.role || 'Staff'}</Text>
              </>
            )}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Account Details</Text>
        <View style={styles.detailsGroup}>
          <TouchableOpacity style={styles.detailItem} onPress={() => {
            setEditingField('phone');
            setEditValue(userRecord?.phone || '');
          }}>
            <View style={styles.detailTextContent}>
              <Text style={styles.detailLabel}>Phone Number</Text>
              <Text style={styles.detailValue}>{userRecord?.phone || '—'}</Text>
            </View>
            <ChevronRightIcon />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.detailItem} onPress={() => {
            setEditingField('email');
            setEditValue(userRecord?.email || auth?.currentUser?.email || '');
          }}>
            <View style={styles.detailTextContent}>
              <Text style={styles.detailLabel}>Email Address</Text>
              <Text style={[styles.detailValue, styles.emailText]}>{auth?.currentUser?.email || userRecord?.email || '—'}</Text>
            </View>
            <ChevronRightIcon />
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity style={styles.detailItem} onPress={() => {
            setEditingField('employeeId');
            setEditValue(userRecord?.employeeId || userRecord?.id || '');
          }}>
            <View style={styles.detailTextContent}>
              <Text style={styles.detailLabel}>Employee ID</Text>
              <Text style={styles.detailValue}>{userRecord?.employeeId || userRecord?.id || '—'}</Text>
            </View>
            <ChevronRightIcon />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.detailsGroup}>
          <TouchableOpacity style={styles.detailItem} onPress={() => setShowPassModal(true)}>
            <View style={styles.detailTextContent}>
              <Text style={styles.detailLabel}>Change Password</Text>
              <Text style={styles.detailSubLabel}>Update your password</Text>
            </View>
            <ChevronRightIcon />
          </TouchableOpacity>

          <View style={styles.divider} />

          <View style={styles.toggleRow}>
            <View style={styles.detailTextContent}>
              <Text style={styles.detailLabel}>Allow Notifications</Text>
              <Text style={styles.detailSubLabel}>Get alerts for tasks and reports</Text>
            </View>
            <Switch
              value={allowNotifications}
              onValueChange={async value => {
                if (value) {
                  await requestNotificationPermission();
                } else {
                  await persistPreference('allowNotifications', false);
                  setAllowNotifications(false);
                }
              }}
              trackColor={{ false: '#d1d5db', true: '#9ae6b4' }}
              thumbColor={allowNotifications ? '#00a63e' : '#f4f4f5'}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.toggleRow}>
            <View style={styles.detailTextContent}>
              <Text style={styles.detailLabel}>Allow Location</Text>
              <Text style={styles.detailSubLabel}>Use your location for map features</Text>
            </View>
            <Switch
              value={allowLocation}
              onValueChange={async value => {
                if (value) {
                  await requestLocationPermission();
                } else {
                  await persistPreference('allowLocation', false);
                  setAllowLocation(false);
                }
              }}
              trackColor={{ false: '#d1d5db', true: '#9ae6b4' }}
              thumbColor={allowLocation ? '#00a63e' : '#f4f4f5'}
            />
          </View>

          {/* 2FA removed as requested */}
        </View>

        <View style={{ marginTop: 10 }}>
          <TouchableOpacity style={[styles.logoutBtn, { backgroundColor: '#ef4444' }]} onPress={async () => {
            try { await signOutUser(); } catch (e) {}
            onLogout();
          }}>
            <Text style={styles.logoutBtnText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={showPassModal} transparent animationType="slide">
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
            <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>Change Password</Text>
              <TextInput placeholder="Current password" secureTextEntry value={currentPass} onChangeText={setCurrentPass} style={{ borderWidth: 1, padding: 8, marginBottom: 10 }} />
              <TextInput placeholder="New password" secureTextEntry value={newPass} onChangeText={setNewPass} style={{ borderWidth: 1, padding: 8, marginBottom: 10 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
                <TouchableOpacity onPress={() => setShowPassModal(false)} style={{ padding: 10 }}>
                  <Text>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={handleChangePassword} style={{ backgroundColor: '#00a63e', padding: 10, borderRadius: 8 }}>
                  <Text style={{ color: '#fff' }}>Change</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Field edit modal */}
        <Modal visible={!!editingField} transparent animationType="slide">
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
            <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>Edit {editingField}</Text>
              <TextInput value={editValue} onChangeText={setEditValue} autoCapitalize={editingField === 'email' ? 'none' : 'sentences'} style={{ borderWidth: 1, padding: 8, marginBottom: 10 }} />
              {editingField === 'email' && (
                <Text style={{ marginBottom: 10, color: '#333' }}>A verification link will be sent to the new address after you tap Verify.</Text>
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
                <TouchableOpacity onPress={() => { setEditingField(null); setEditValue(''); }} style={{ padding: 10 }}>
                  <Text>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={async () => {
                  // save field
                  if (!userRecord?.id) { Alert.alert('Error', 'No user record'); return; }
                  const fieldKey = editingField === 'employeeId' ? 'employeeId' : editingField; // phone/email
                  try {
                    if (editingField === 'email') {
                      // update Firebase Auth email first
                      try {
                        await updateEmail(auth.currentUser, editValue);
                      } catch (e) {
                        const code = e?.code || '';
                        const msg = e?.message || '';
                        if (code === 'auth/requires-recent-login' || /recent/i.test(msg)) {
                          // need reauthentication — open reauth modal
                          setReauthModalVisible(true);
                          return;
                        }
                        Alert.alert('Email update failed', msg || 'Could not update email');
                        return;
                      }

                      // send verification to the new email and save as pending in DB
                      try { await sendEmailVerification(auth.currentUser); } catch (e) { console.warn('sendEmailVerification failed', e); }
                      await update(ref(db, `users/${userRecord.id}`), { pendingEmail: editValue, emailVerified: false });
                      setPendingEmail(editValue);
                      setVerificationPending(true);
                      setEditingField(null);
                      setEditValue('');
                      Alert.alert('Verification Sent', 'A verification link was sent to the new address. Please verify to finalize the change.');
                      return;
                    }

                    await update(ref(db, `users/${userRecord.id}`), { [fieldKey]: editValue });
                    setUserRecord(prev => ({ ...(prev||{}), [fieldKey]: editValue }));
                    setEditingField(null);
                    setEditValue('');
                    Alert.alert('Saved', 'Field updated');
                  } catch (e) {
                    console.warn('Field save failed', e);
                    Alert.alert('Error', e?.message || 'Failed to save field');
                  }
                }} style={{ backgroundColor: '#00a63e', padding: 10, borderRadius: 8 }}>
                  <Text style={{ color: '#fff' }}>{editingField === 'email' ? 'Verify' : 'Save'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Reauthentication modal used when email update requires recent login */}
        <Modal visible={reauthModalVisible} transparent animationType="slide">
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
            <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>Re-enter Password</Text>
              <Text style={{ marginBottom: 8 }}>For security, please enter your current password to continue.</Text>
              <TextInput placeholder="Current password" secureTextEntry value={reauthPassword} onChangeText={setReauthPassword} style={{ borderWidth: 1, padding: 8, marginBottom: 10 }} />
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
                <TouchableOpacity onPress={() => { setReauthModalVisible(false); setReauthPassword(''); }} style={{ padding: 10 }}>
                  <Text>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={async () => {
                  // call reauth and retry with pending editValue
                  await handleReauthAndRetryEmail(editValue);
                }} style={{ backgroundColor: '#00a63e', padding: 10, borderRadius: 8 }}>
                  <Text style={{ color: '#fff' }}>{reauthLoading ? 'Please wait...' : 'Reauthenticate'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Verification pending modal */}
        <Modal visible={verificationPending} transparent animationType="slide">
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
            <View style={{ width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>Verify New Email</Text>
              <Text style={{ marginBottom: 8 }}>A verification link was sent to:</Text>
              <Text style={{ fontWeight: '600', marginBottom: 12 }}>{pendingEmail}</Text>
              <Text style={{ marginBottom: 12 }}>Please open that email and click the verification link. Once done, tap the button below to finalize the change.</Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
                <TouchableOpacity onPress={() => { setVerificationPending(false); setPendingEmail(''); }} style={{ padding: 10 }}>
                  <Text>Dismiss</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={checkEmailVerification} style={{ backgroundColor: '#00a63e', padding: 10, borderRadius: 8 }}>
                  <Text style={{ color: '#fff' }}>I verified — Check now</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 100,
  },
  profileCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
    marginBottom: 25,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 20,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: '#d1d1d1',
  },
  cameraBtn: {
    position: 'absolute',
    bottom: -5,
    right: -5,
    backgroundColor: PRIMARY_GREEN,
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  cameraIcon: {
    fontSize: 14,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1c1c1c',
  },
  profileRole: {
    fontSize: 16,
    color: '#33803f',
    fontWeight: '500',
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1c1c1c',
    marginBottom: 10,
  },
  detailsGroup: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    marginBottom: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
  },
  detailTextContent: {
    flex: 1,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
  },
  detailLabel: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#1c1c1c',
  },
  detailValue: {
    fontSize: 14,
    color: '#717171',
    marginTop: 2,
  },
  detailSubLabel: {
    fontSize: 13,
    color: '#717171',
    marginTop: 2,
  },
  emailText: {
    textDecorationLine: 'underline',
    color: '#717171',
  },
  divider: {
    height: 1,
    backgroundColor: '#f0f0f0',
    marginHorizontal: 15,
  },
  logoutBtn: {
    backgroundColor: PRIMARY_GREEN,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  logoutBtnText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default ProfilePage;
