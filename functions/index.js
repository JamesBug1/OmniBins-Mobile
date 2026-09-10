const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

// Utility: safe get value
const getVal = (snap) => (snap && snap.val ? snap.val() : null);

// Trigger on create or update of a task. Sends notifications to team members.
exports.notifyTeamOnTaskAssign = functions.database
  .ref('/tasks/{taskId}')
  .onWrite(async (change, context) => {
    // Only proceed on create or when assigned team changed.
    const before = getVal(change.before);
    const after = getVal(change.after);
    const taskId = context.params.taskId;

    if (!after) {
      // deleted
      return null;
    }

    // If this is an update and team did not change and not a new assignment, still notify on certain transitions
    const teamName = after.assignedToTeam || after.team || after.group || after.assignedTeam;
    if (!teamName) return null;

    // If update and nothing relevant changed, avoid noisy notifications
    if (before) {
      const prevTeam = before.assignedToTeam || before.team || before.group || before.assignedTeam;
      const prevStatus = before.status;
      const newStatus = after.status;
      const teamUnchanged = String(prevTeam) === String(teamName);
      const created = !before;
      // If team unchanged and status unchanged and not newly created, skip
      if (teamUnchanged && prevStatus === newStatus && before) {
        // but still notify if task was just assigned (i.e., created) - handled by absence of before
        return null;
      }
    }

    // Collect FCM tokens from users who belong to this team
    const usersSnap = await admin.database().ref('/users').once('value');
    const users = usersSnap.val() || {};
    const tokens = [];
    Object.keys(users).forEach((uid) => {
      const u = users[uid];
      if (!u) return;
      // Check multiple schema variants
      const uTeams = [];
      if (u.team) uTeams.push(u.team);
      if (u.teamName) uTeams.push(u.teamName);
      if (u.teams && Array.isArray(u.teams)) u.teams.forEach(t => uTeams.push(t));
      if (u.groups && Array.isArray(u.groups)) u.groups.forEach(t => uTeams.push(t));
      const matches = uTeams.some(t => String(t) === String(teamName));
      if (matches && u.fcmToken) tokens.push(u.fcmToken);
    });

    if (!tokens.length) {
      console.log('No tokens for team', teamName);
      return null;
    }

    const notificationTitle = after.title || after.name || `Task assigned to ${teamName}`;
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
      }
    }

    return null;
  });
