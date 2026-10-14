require('dotenv').config();
const { applicationDefault, cert, initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');

const serviceAccountPath = process.env.SERVICE_ACCOUNT_PATH || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const appOptions = {
  databaseURL: process.env.FIREBASE_DATABASE_URL || 'https://omnibins-default-rtdb.firebaseio.com',
};

if (serviceAccountPath) {
  try {
    const serviceAccount = require(serviceAccountPath);
    appOptions.credential = cert(serviceAccount);
  } catch (err) {
    console.error('Failed to load Firebase service-account credentials', err);
    process.exit(1);
  }
} else {
  console.log('No service account path provided; attempting Application Default Credentials');
  appOptions.credential = applicationDefault();
}

const firebaseApp = initializeApp(appOptions);

const db = getDatabase(firebaseApp);
const tasksRef = db.ref('/tasks');

const lastAssignmentByTask = new Map();
const teamFields = ['assignedToTeam', 'teamName', 'team', 'team_id', 'teamId', 'assignedTeam', 'groupName', 'group', 'department'];
const userFields = ['assignedTo', 'assignedToUid', 'assignedUserId', 'assigneeId', 'staffId', 'userId', 'uid', 'workerId', 'employeeId', 'assignedEmail', 'staffEmail', 'userEmail', 'assignedStaff'];

const normalize = (value) => String(value || '').trim().toLowerCase();
const valuesFrom = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(valuesFrom);
  if (typeof value === 'object') return Object.values(value).flatMap(valuesFrom);
  return [value];
};

const getAssignments = (task) => ({
  teams: [...new Set(teamFields.flatMap((field) => valuesFrom(task?.[field])).map(normalize).filter(Boolean))].sort(),
  users: [...new Set(userFields.flatMap((field) => valuesFrom(task?.[field])).map(normalize).filter(Boolean))].sort(),
});

const getAssignmentKey = (task) => JSON.stringify(getAssignments(task));

async function loadExistingTasks() {
  const snap = await tasksRef.once('value');
  const data = snap.val() || {};
  Object.keys(data).forEach((taskId) => {
    lastAssignmentByTask.set(taskId, getAssignmentKey(data[taskId] || {}));
  });
  console.log('Loaded', lastAssignmentByTask.size, 'existing tasks into cache');
}

async function sendNotificationsForTask(taskId, task) {
  const assignments = getAssignments(task);
  if (!assignments.teams.length && !assignments.users.length) return;

  const usersSnap = await db.ref('/users').once('value');
  const users = usersSnap.val() || {};
  const tokens = [];
  const matchedWithoutToken = [];
  Object.entries(users).forEach(([userId, user]) => {
    if (!user || typeof user !== 'object') return;
    const userTeams = [...teamFields, 'teams', 'teamNames', 'teamIds', 'groups']
      .flatMap((field) => valuesFrom(user[field])).map(normalize);
    const userIdentities = [userId, user.uid, user.id, user.employeeId, user.email].map(normalize);
    const matches = userTeams.some((team) => assignments.teams.includes(team))
      || userIdentities.some((identity) => assignments.users.includes(identity));
    if (!matches) return;
    if (user.fcmToken) tokens.push(user.fcmToken);
    else matchedWithoutToken.push(userId);
  });

  const uniqueTokens = [...new Set(tokens)];
  if (!uniqueTokens.length) {
    console.log('No FCM tokens matched task assignment', taskId, assignments);
    if (matchedWithoutToken.length) {
      console.log('Matched users without fcmToken:', matchedWithoutToken);
    } else {
      console.log('No users matched task assignment', taskId);
    }
    return;
  }

  const title = task.title || task.name || `Task assigned${assignments.teams.length ? ` to ${assignments.teams[0]}` : ''}`;
  const body = task.description || task.body || `Tap to view task ${taskId}`;

  const message = {
    notification: { title, body },
    data: { taskId: String(taskId), type: 'task_assigned' },
    android: { priority: 'high' },
  };

  const chunkSize = 500;
  for (let i = 0; i < uniqueTokens.length; i += chunkSize) {
    const chunk = uniqueTokens.slice(i, i + chunkSize);
    try {
      const resp = await getMessaging(firebaseApp).sendEachForMulticast({ ...message, tokens: chunk });
      console.log(`Sent ${resp.successCount}/${chunk.length} notifications for task ${taskId}`);
      if (resp.failureCount) {
        resp.responses.forEach((r, idx) => {
          if (!r.success) console.warn('Failed token index:', idx, r.error && r.error.toString());
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
            const r = await getMessaging(firebaseApp).send(singleMsg);
            console.log('Sent single message to token, msgId=', r);
          } catch (singleErr) {
            console.error('Failed single send', singleErr && singleErr.message ? singleErr.message : singleErr);
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
  if (lastAssignmentByTask.has(taskId)) return;
  lastAssignmentByTask.set(taskId, getAssignmentKey(task));
  console.log('New task detected:', taskId);
  await sendNotificationsForTask(taskId, task);
}

async function handleChildChanged(snapshot) {
  const taskId = snapshot.key;
  const task = snapshot.val();
  const assignmentKey = getAssignmentKey(task);
  const previousAssignmentKey = lastAssignmentByTask.get(taskId);
  if (previousAssignmentKey !== assignmentKey) {
    console.log('Task assignment changed:', taskId);
    lastAssignmentByTask.set(taskId, assignmentKey);
    await sendNotificationsForTask(taskId, task);
  } else {
    console.log('Task changed without assignment change; skipping:', taskId);
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
