// Minimal Firebase Web SDK config for React Native JS usage (no native modules)
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, update, onDisconnect, serverTimestamp } from 'firebase/database';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { PermissionsAndroid, Platform } from 'react-native';
import notifee, { AndroidImportance } from '@notifee/react-native';
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  hasPermission,
  requestPermission,
} from '@react-native-firebase/messaging';

// Replace these values if you want to use different envs; using web config from OmniBins web app
const firebaseConfig = {
  apiKey: 'AIzaSyD1b7Z3zJeuvvo6iMWQxvFHdbClCFSlSuI',
  authDomain: 'omnibins.firebaseapp.com',
  databaseURL: 'https://omnibins-default-rtdb.firebaseio.com',
  projectId: 'omnibins',
  storageBucket: 'omnibins.firebasestorage.app',
  messagingSenderId: '889817277774',
  appId: '1:889817277774:web:3912f8166047545a8f2a1f',
  measurementId: 'G-V9BW9RGDNQ',
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

let activePresenceUserId = null;

export async function ensureTaskNotificationChannel() {
  if (Platform.OS !== 'android') return null;

  return notifee.createChannel({
    id: 'task-updates-v2',
    name: 'Task updates',
    description: 'Alerts when a task is assigned to you',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
  });
}

export async function markUserOnline(userId) {
  if (!userId) return;

  const presenceRef = ref(db, `users/${userId}`);
  await onDisconnect(presenceRef).update({
    onlineStatus: 'offline',
    lastSeen: serverTimestamp(),
  });
  await update(presenceRef, {
    onlineStatus: 'online',
    lastSeen: serverTimestamp(),
  });
  activePresenceUserId = userId;
}

export async function markUserOffline(userId = activePresenceUserId) {
  if (!userId) return;

  const presenceRef = ref(db, `users/${userId}`);
  await update(presenceRef, {
    onlineStatus: 'offline',
    lastSeen: serverTimestamp(),
  });
  await onDisconnect(presenceRef).cancel();
  if (activePresenceUserId === userId) activePresenceUserId = null;
}

export async function signInAndAuthorize(email, password) {
  // Sign in with Firebase Auth (web SDK)
  const credential = await signInWithEmailAndPassword(auth, email, password);

  // After sign-in, verify user record in Realtime Database under `users` and check role
  const usersSnap = await get(ref(db, 'users'));
  const users = usersSnap.val();
  if (!users) {
    // No user records — deny by default
    await signOut(auth);
    throw new Error('No user records found');
  }

  const emailLower = (email || '').toLowerCase();
  // Find by email field in users records
  const match = Object.entries(users).find(([, value]) => {
    if (!value || typeof value !== 'object') return false;
    const userEmail = (value.email || '').toLowerCase();
    return userEmail === emailLower;
  });

  if (!match) {
    // Not found in users list
    await signOut(auth);
    throw new Error('Account not authorized for this app');
  }

  const [userId, userRecord] = match;
  if (String(userRecord.status || '').trim().toLowerCase() === 'pending') {
    await signOut(auth);
    throw new Error('Account is pending approval');
  }

  // Only allow role 'staff'
  if ((userRecord.role || '').toLowerCase() !== 'staff') {
    await signOut(auth);
    throw new Error('Only staff accounts can sign in to the mobile app');
  }

  try {
    await markUserOnline(userId);
  } catch (error) {
    console.warn('Could not update user presence', error?.message || error);
  }

  return { credential, userId, userRecord };
}

export async function getUserRecordIdForCurrentUser(userId = auth.currentUser?.uid) {
  if (!userId) return null;

  const directUserSnapshot = await get(ref(db, `users/${userId}`));
  if (directUserSnapshot.exists()) return userId;

  const currentUser = auth.currentUser;
  const usersSnapshot = await get(ref(db, 'users'));
  const users = usersSnapshot.val() || {};
  const currentEmail = (currentUser?.email || '').toLowerCase();
  const matchingUser = Object.entries(users).find(([id, record]) => (
    id === userId
    || record?.uid === userId
    || (currentEmail && (record?.email || '').toLowerCase() === currentEmail)
  ));

  return matchingUser?.[0] || null;
}

export async function registerDeviceTokenForCurrentUser(userId) {
  if (!userId) return null;

  try {
    const userRecordId = await getUserRecordIdForCurrentUser(userId);

    if (!userRecordId) {
      throw new Error('Could not find the signed-in user record in the database.');
    }

    await ensureTaskNotificationChannel();

    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const permission = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      if (permission !== PermissionsAndroid.RESULTS.GRANTED) {
        await update(ref(db, `users/${userRecordId}`), { allowNotifications: false, fcmToken: null });
        return null;
      }
    }

    const messagingInstance = getMessaging();
    const permissionState = await hasPermission(messagingInstance);
    const alreadyGranted = permissionState === AuthorizationStatus.AUTHORIZED
      || permissionState === AuthorizationStatus.PROVISIONAL;

    let authStatus = permissionState;
    if (!alreadyGranted) {
      authStatus = await requestPermission(messagingInstance);
    }

    const enabled = authStatus === AuthorizationStatus.AUTHORIZED
      || authStatus === AuthorizationStatus.PROVISIONAL;

    if (!enabled) {
      await update(ref(db, `users/${userRecordId}`), { allowNotifications: false, fcmToken: null });
      return null;
    }

    const token = await getToken(messagingInstance);
    if (!token) {
      throw new Error('Firebase Messaging did not return a device token.');
    }

    await update(ref(db, `users/${userRecordId}`), {
      fcmToken: token,
      allowNotifications: true,
      updatedAt: new Date().toISOString(),
    });

    return token;
  } catch (e) {
    console.warn('Device token registration failed', e);
    throw e;
  }
}

export async function unregisterDeviceTokenForCurrentUser(userId) {
  const userRecordId = await getUserRecordIdForCurrentUser(userId);
  if (!userRecordId) return false;

  await update(ref(db, `users/${userRecordId}`), {
    allowNotifications: false,
    fcmToken: null,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

export async function signOutUser() {
  try {
    await markUserOffline();
  } catch (error) {
    console.warn('Could not mark user offline', error?.message || error);
  }
  return signOut(auth);
}

export default app;
