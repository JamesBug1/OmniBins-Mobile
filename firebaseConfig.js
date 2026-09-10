// Minimal Firebase Web SDK config for React Native JS usage (no native modules)
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get, update } from 'firebase/database';
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import messaging from '@react-native-firebase/messaging';

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
  // Only allow role 'staff'
  if ((userRecord.role || '').toLowerCase() !== 'staff') {
    await signOut(auth);
    throw new Error('Only staff accounts can sign in to the mobile app');
  }

  return { credential, userId, userRecord };
}

export async function registerDeviceTokenForCurrentUser(userId) {
  if (!userId) return null;

  try {
    const authStatus = await messaging().requestPermission();
    const enabled = authStatus === 1 || authStatus === 2 || authStatus === 'granted';

    if (!enabled) {
      await update(ref(db, `users/${userId}`), { allowNotifications: false });
      return null;
    }

    const token = await messaging().getToken();
    if (!token) return null;

    await update(ref(db, `users/${userId}`), {
      fcmToken: token,
      allowNotifications: true,
      updatedAt: new Date().toISOString(),
    });

    return token;
  } catch (e) {
    console.warn('Device token registration failed', e);
    return null;
  }
}

export async function signOutUser() {
  return signOut(auth);
}

export default app;
