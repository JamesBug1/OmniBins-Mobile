const functions = require('firebase-functions');
const admin = require('firebase-admin');

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
    const tokens = [...new Set(Object.entries(users).flatMap(([id, user]) => {
      if (!user || typeof user !== 'object' || !user.fcmToken) return [];
      const matchesTeam = getUserTeams(user).some((team) => assignments.teams.includes(team));
      const matchesUser = getUserIdentities(id, user).some((identity) => assignments.users.includes(identity));
      return matchesTeam || matchesUser ? [user.fcmToken] : [];
    }))];

    if (!tokens.length) {
      console.log('No FCM tokens matched task assignment', taskId, assignments);
      return null;
    }

    const assignedTeam = assignments.teams[0];
    const notificationTitle = after.title || after.name || (assignedTeam ? `Task assigned to ${assignedTeam}` : 'Task assigned to you');
    const notificationBody = after.description || after.body || `Tap to view task ${taskId}`;

    const message = {
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        taskId: taskId,
        type: 'task_assigned',
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
