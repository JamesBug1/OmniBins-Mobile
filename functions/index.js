const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

const getVal = (snap) => (snap && snap.val ? snap.val() : null);
const normalize = (value) => String(value || '').trim().toLowerCase();
const valuesFrom = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(valuesFrom);
  if (typeof value === 'object') return Object.values(value).flatMap(valuesFrom);
  return [value];
};

const teamFields = ['assignedToTeam', 'teamName', 'team', 'team_id', 'teamId', 'assignedTeam', 'groupName', 'group', 'department'];
const userFields = ['assignedTo', 'assignedToUid', 'assignedUserId', 'assigneeId', 'staffId', 'userId', 'uid', 'workerId', 'employeeId', 'assignedEmail', 'staffEmail', 'userEmail', 'assignedStaff'];

const getAssignments = (task) => {
  const teams = teamFields.flatMap((field) => valuesFrom(task[field])).map(normalize).filter(Boolean);
  const users = userFields.flatMap((field) => valuesFrom(task[field])).map(normalize).filter(Boolean);
  return { teams: [...new Set(teams)].sort(), users: [...new Set(users)].sort() };
};

const getUserTeams = (user) => [
  ...teamFields,
  'teams', 'teamNames', 'teamIds', 'groups',
].flatMap((field) => valuesFrom(user[field])).map(normalize).filter(Boolean);

const getUserIdentities = (id, user) => [
  id, user.uid, user.id, user.employeeId, user.email,
].map(normalize).filter(Boolean);

const assignmentKey = (task) => JSON.stringify(getAssignments(task));
const getTaskType = (task) => {
  const value = task.type || task.taskType || task.category || task.taskCategory || task.task_type || task.serviceType;
  if (!value || typeof value !== 'string') return null;
  return value.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
};

// Trigger on create or update of a task. Sends notifications to team members.
exports.notifyTeamOnTaskAssign = functions.database
  .ref('/tasks/{taskId}')
  .onWrite(async (change, context) => {
    const before = getVal(change.before);
    const after = getVal(change.after);
    const taskId = context.params.taskId;

    if (!after) return null;

    const assignments = getAssignments(after);
    if (!assignments.teams.length && !assignments.users.length) return null;
    if (before && assignmentKey(before) === assignmentKey(after)) return null;

    const usersSnap = await admin.database().ref('/users').once('value');
    const users = usersSnap.val() || {};
    const taskType = getTaskType(after);
    const title = taskType ? `${taskType} task assigned` : 'New task assigned';
    const taskTitle = after.title || after.name || after.binId || after.bin || null;
    const taskDetails = after.description || after.body;
    const body = taskDetails
      ? (taskTitle ? `${taskTitle}: ${taskDetails}` : taskDetails)
      : (taskTitle || 'A new task has been assigned to you.');
    const notificationId = `task_${crypto.createHash('sha256').update(`${taskId}:${assignmentKey(after)}`).digest('hex').slice(0, 32)}`;
    const notification = {
      type: 'task_assigned',
      taskType: taskType || null,
      taskId: String(taskId),
      title,
      body,
      createdAt: admin.database.ServerValue.TIMESTAMP,
      read: false,
    };
    const inboxWrites = [];
    const tokens = [...new Set(Object.entries(users).flatMap(([id, user]) => {
      if (!user || typeof user !== 'object') return [];
      const matchesTeam = getUserTeams(user).some((team) => assignments.teams.includes(team));
      const matchesUser = getUserIdentities(id, user).some((identity) => assignments.users.includes(identity));
      if (!matchesTeam && !matchesUser) return [];

      inboxWrites.push(admin.database().ref(`/users/${id}/notifications/${notificationId}`).transaction(current => current || notification));
      return user.allowNotifications === true && user.fcmToken ? [user.fcmToken] : [];
    }))];

    await Promise.all(inboxWrites);

    if (!tokens.length) {
      console.log('Saved inbox notices; no opted-in FCM tokens matched task assignment', taskId, assignments);
      return null;
    }

    const message = {
      notification: {
        title,
        body,
      },
      data: {
        taskId: taskId,
        type: 'task_assigned',
      },
      android: {
        priority: 'high',
        notification: { channelId: 'task-updates-v2' },
      },
    };

    // sendMulticast supports up to 500 tokens per call
    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      const multicast = {
        ...message,
        tokens: chunk,
      };
      try {
        const resp = await admin.messaging().sendMulticast(multicast);
        console.log(`Sent chunk ${i}/${tokens.length}: success=${resp.successCount} failure=${resp.failureCount}`);
        if (resp.failureCount) {
          resp.responses.forEach((r, idx) => {
            if (!r.success) {
              console.warn('Failed token:', chunk[idx], r.error && r.error.toString());
            }
          });
        }
      } catch (err) {
        console.error('sendMulticast error', err);
        throw err;
      }
    }

    return null;
  });
