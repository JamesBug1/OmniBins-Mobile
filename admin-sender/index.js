require('dotenv').config();
const admin = require('firebase-admin');

// Initialize Admin SDK
// Provide SERVICE_ACCOUNT_PATH or set GOOGLE_APPLICATION_CREDENTIALS env var
const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (serviceAccountPath) {
  try {
    const serviceAccount = require(serviceAccountPath);
    // Print non-secret identifying fields for verification
    try {
      const clientEmail = serviceAccount.client_email || '(none)';
      const keyId = serviceAccount.private_key_id || '(none)';
      console.log('Using service account file:', serviceAccountPath);
      console.log('service account client_email:', clientEmail);
      console.log('service account private_key_id:', keyId);
    } catch (e) {
      console.log('Loaded service account file but could not read identifying fields');
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://omnibins-default-rtdb.firebaseio.com',
    });
  } catch (err) {
    console.error('Failed to load service account from', serviceAccountPath, err);
    process.exit(1);
  }
} else {
  console.log('No service account path provided; attempting Application Default Credentials');
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://omnibins-default-rtdb.firebaseio.com',
  });
}

// Diagnostic startup info
try {
  const adminPkg = require('firebase-admin/package.json');
  console.log('firebase-admin version:', adminPkg.version);
} catch (e) {
  console.log('Could not read firebase-admin version');
}
console.log('Env: HTTP_PROXY=', process.env.HTTP_PROXY || process.env.http_proxy || '(none)',
  'HTTPS_PROXY=', process.env.HTTPS_PROXY || process.env.https_proxy || '(none)');
console.log('NO_PROXY=', process.env.NO_PROXY || process.env.no_proxy || '(none)');
console.log('FIREBASE_MESSAGING_EMULATOR_HOST=', process.env.FIREBASE_MESSAGING_EMULATOR_HOST || '(unset)');
console.log('FIREBASE_EMULATOR_HOST=', process.env.FIREBASE_EMULATOR_HOST || '(unset)');
console.log('GOOGLE_APPLICATION_CREDENTIALS=', process.env.GOOGLE_APPLICATION_CREDENTIALS || '(unset)');
console.log('NODE_TLS_REJECT_UNAUTHORIZED=', process.env.NODE_TLS_REJECT_UNAUTHORIZED || '(unset)');

const db = admin.database();
const tasksRef = db.ref('/tasks');

// in-memory cache of last-known team per task to avoid duplicate notifications during runtime
const lastTeamByTask = new Map();

async function loadExistingTasks() {
  const snap = await tasksRef.once('value');
  const data = snap.val() || {};
  Object.keys(data).forEach((taskId) => {
    const t = data[taskId];
    const team = t.assignedToTeam || t.team || t.group || t.assignedTeam || null;
    if (team) lastTeamByTask.set(taskId, String(team));
  });
  console.log('Loaded', lastTeamByTask.size, 'existing tasks into cache');
}

function getTeamFromTask(task) {
  if (!task) return null;
  return task.assignedToTeam || task.team || task.group || task.assignedTeam || null;
}

async function sendNotificationsForTask(taskId, task) {
  const teamName = getTeamFromTask(task);
  if (!teamName) return;

  // fetch users once
  const usersSnap = await db.ref('/users').once('value');
  const users = usersSnap.val() || {};
  console.log('Scanning', Object.keys(users).length, 'users for team', teamName);
  const tokens = [];
  const matchedWithoutToken = [];
  Object.keys(users).forEach((uid) => {
    const u = users[uid];
    if (!u) return;
    const uTeams = [];
    if (u.team) uTeams.push(u.team);
    if (u.teamName) uTeams.push(u.teamName);
    if (u.teams && Array.isArray(u.teams)) u.teams.forEach(t => uTeams.push(t));
    if (u.groups && Array.isArray(u.groups)) u.groups.forEach(t => uTeams.push(t));
    const matches = uTeams.some(t => String(t) === String(teamName));
    if (matches && u.fcmToken) tokens.push(u.fcmToken);
    if (matches && !u.fcmToken) matchedWithoutToken.push({ uid, user: u });
  });

  if (!tokens.length) {
    console.log('No tokens for team', teamName);
    if (matchedWithoutToken.length) {
      console.log('Matched users without fcmToken for team', teamName, ':', matchedWithoutToken.map(m => m.uid));
    } else {
      console.log('No users matched team', teamName);
    }
    return;
  }

  const title = task.title || task.name || `Task assigned to ${teamName}`;
  const body = task.description || task.body || `Tap to view task ${taskId}`;

  const message = {
    notification: { title, body },
    data: { taskId: String(taskId), type: 'task_assigned' },
  };

  // send in chunks
  const chunkSize = 500;
  for (let i = 0; i < tokens.length; i += chunkSize) {
    const chunk = tokens.slice(i, i + chunkSize);
    try {
      const resp = await admin.messaging().sendMulticast({ ...message, tokens: chunk });
      console.log(`Sent ${resp.successCount}/${chunk.length} notifications for task ${taskId}`);
      if (resp.failureCount) {
        resp.responses.forEach((r, idx) => {
          if (!r.success) console.warn('Failed token:', chunk[idx], r.error && r.error.toString());
        });
      }
    } catch (err) {
      console.error('Error sending multicast', err && err.message ? err.message : err);
      // If multicast fails (404 batch endpoint or unknown server error), try per-token sends as a fallback
      try {
        console.log('Falling back to individual sends for', chunk.length, 'tokens');
        for (const t of chunk) {
          const singleMsg = { ...message, token: t };
          try {
            const r = await admin.messaging().send(singleMsg);
            console.log('Sent single message to token, msgId=', r);
          } catch (singleErr) {
            console.error('Failed single send to token', t, singleErr && singleErr.message ? singleErr.message : singleErr);
          }
        }
      } catch (fallbackErr) {
        console.error('Fallback individual sends failed', fallbackErr && fallbackErr.message ? fallbackErr.message : fallbackErr);
      }
    }
  }
}

async function handleChildAdded(snapshot) {
  const taskId = snapshot.key;
  const task = snapshot.val();
  const team = getTeamFromTask(task);
  lastTeamByTask.set(taskId, team ? String(team) : null);
  console.log('child_added', taskId, 'team=', team);
  await sendNotificationsForTask(taskId, task);
}

async function handleChildChanged(snapshot) {
  const taskId = snapshot.key;
  const task = snapshot.val();
  const team = getTeamFromTask(task);
  const prev = lastTeamByTask.get(taskId) || null;
  if (String(prev) !== String(team)) {
    console.log('child_changed team changed for', taskId, 'from', prev, 'to', team);
    lastTeamByTask.set(taskId, team ? String(team) : null);
    await sendNotificationsForTask(taskId, task);
  } else {
    // not a team change; ignore
    // optionally, handle status transitions if desired
  }
}

async function main() {
  await loadExistingTasks();

  tasksRef.on('child_added', handleChildAdded, (err) => console.error('child_added listener error', err));
  tasksRef.on('child_changed', handleChildChanged, (err) => console.error('child_changed listener error', err));

  console.log('Listening for task assignments...');
}

main().catch(err => {
  console.error('Fatal error', err);
  process.exit(1);
});
