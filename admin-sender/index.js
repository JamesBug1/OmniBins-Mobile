require('dotenv').config();
const { applicationDefault, cert, initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getMessaging } = require('firebase-admin/messaging');
const crypto = require('crypto');

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
const systemAlertsRef = db.ref('/alerts');
const sensorPaths = ['sensor_data1', 'sensor_data2'];
const gasAlertThreshold = Number(process.env.GAS_ALERT_THRESHOLD || 1000);
const gasAlertMaxAgeMs = Number(process.env.GAS_ALERT_MAX_AGE_MS || 15 * 60 * 1000);

const lastAssignmentByTask = new Map();
const latestSensorByBin = new Map();
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
const isRecurringTemplate = (task) => ['daily', 'weekly'].includes(normalize(task?.recurrence))
  && task?.isRecurringOccurrence !== true;
const getTaskType = (task) => {
  const value = task?.type || task?.taskType || task?.category || task?.taskCategory || task?.task_type || task?.serviceType;
  if (!value || typeof value !== 'string') return null;
  return value.trim().replace(/[_-]+/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
};

const getBinId = (record) => String(
  record?.node || record?.binId || record?.bin_id || record?.binID || record?.bin || record?.id || '',
).trim();

const getBinFullState = (record) => {
  const fillValues = [record?.fillLevel, record?.fillPercentage, record?.fill_percent, record?.fill, record?.level];
  const isAtCapacity = fillValues.some((value) => {
    if (value === null || value === undefined || value === '') return false;
    const percentage = Number(String(value).replace('%', '').trim());
    return Number.isFinite(percentage) && percentage >= 100;
  });
  const weightValue = record?.weight;
  const weight = weightValue === null || weightValue === undefined || weightValue === ''
    ? Number.NaN
    : Number(String(weightValue).replace(/[^0-9.+-]/g, ''));
  const isAtWeightLimit = Number.isFinite(weight) && weight >= 50;
  const statusValues = [record?.status, record?.state, record?.condition, record?.distance, record?.fillStatus];
  const hasFullStatus = statusValues.some((value) => /\b(full|at capacity|100%|critical full)\b/i.test(String(value || '')));
  return isAtCapacity || isAtWeightLimit || hasFullStatus;
};

const getGasMeasurements = (record) => ({
  mq4: Number(record?.mq4),
  mq135: Number(record?.mq135),
});

const getHighGasMeasurements = (record) => Object.entries(getGasMeasurements(record))
  .filter(([, value]) => Number.isFinite(value) && value >= gasAlertThreshold);

const getRecordTime = (record) => {
  const rawValue = record?.timestamp || record?.updatedAt || record?.createdAt || '';
  const value = typeof rawValue === 'number' ? rawValue : Date.parse(rawValue);
  return Number.isFinite(value) ? value : 0;
};

const getAppDateKey = (value = Date.now()) => {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.APP_TIME_ZONE || 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};

const getLatestSensorRecords = (data) => {
  const latestByBin = new Map();
  Object.entries(data || {}).forEach(([recordId, record = {}]) => {
    const binId = getBinId(record);
    if (!binId) return;
    const candidate = { ...record, id: recordId, node: binId };
    const previous = latestByBin.get(binId);
    if (!previous || getRecordTime(candidate) >= getRecordTime(previous)) {
      latestByBin.set(binId, candidate);
    }
  });
  return latestByBin;
};

const getCollectionAssignmentsForBin = async (binId) => {
  const [collectionsSnap, tasksSnap] = await Promise.all([
    db.ref('/collections').once('value'),
    db.ref('/tasks').once('value'),
  ]);
  const normalizedBinId = normalize(binId);
  const records = [
    ...Object.values(collectionsSnap.val() || {}),
    ...Object.values(tasksSnap.val() || {}),
  ];
  return records.filter((record) => {
    if (!record || typeof record !== 'object') return false;
    const taskType = normalize(record.type || record.taskType || record.category);
    if (taskType && taskType !== 'collection' && taskType !== 'collections') return false;
    const status = normalize(record.status);
    if (['cancelled', 'canceled'].includes(status)) return false;
      const recurringTemplate = isRecurringTemplate(record);
      if (!recurringTemplate && ['completed', 'complete', 'done'].includes(status)) return false;
    const assignedBinId = normalize(record.binId || record.bin_id || record.binID || record.bin || record.node || record.locationId);
    return assignedBinId === normalizedBinId;
  });
};

const chooseCollectionAssignmentForDate = (assignments, dateKey) => {
  const scheduledForDate = assignments.find((assignment) => {
    const scheduledDate = assignment.scheduledDate || assignment.date || assignment.scheduleDate || assignment.taskDate;
    return scheduledDate && String(scheduledDate).slice(0, 10) === dateKey;
  });
  if (scheduledForDate) return scheduledForDate;

  return assignments.find((assignment) => (
    ['daily', 'weekly'].includes(normalize(assignment.recurrence))
    && assignment.isRecurringOccurrence !== true
  )) || assignments[0] || null;
};

async function removeGeneratedRecurrenceOccurrences() {
  const [tasksSnapshot, collectionsSnapshot] = await Promise.all([
    db.ref('/tasks').once('value'),
    db.ref('/collections').once('value'),
  ]);
  const updates = {};

  Object.entries(tasksSnapshot.val() || {}).forEach(([id, task]) => {
    if (task?.isRecurringOccurrence === true && task?.isCapacityTriggered !== true && task?.isHighGasTriggered !== true) {
      updates[`tasks/${id}`] = null;
      updates[`collections/${id}`] = null;
    }
  });
  Object.entries(collectionsSnapshot.val() || {}).forEach(([id, task]) => {
    if (task?.isRecurringOccurrence === true && task?.isCapacityTriggered !== true && task?.isHighGasTriggered !== true) {
      updates[`collections/${id}`] = null;
      if (!tasksSnapshot.child(id).exists()) updates[`tasks/${id}`] = null;
    }
  });

  if (Object.keys(updates).length) {
    await db.ref('/').update(updates);
    console.log(`Removed ${Object.keys(updates).length} generated recurrence rows; preserved templates and capacity tasks.`);
  } else {
    console.log('No generated recurrence rows to remove.');
  }
}

async function createAlertCollectionOccurrence(binId, sensorRecord, assignment, dateKey, location, alertType) {
  const alertPrefix = alertType === 'high_gas' ? 'gas_collection' : 'capacity_collection';
  const generatedId = `${alertPrefix}_${normalize(binId).replace(/[^a-z0-9_-]/g, '_')}_${dateKey.replace(/-/g, '')}`;
  const [tasksSnapshot, collectionsSnapshot] = await Promise.all([
    db.ref('/tasks').once('value'),
    db.ref('/collections').once('value'),
  ]);
  const sameDayTasks = [
    ...Object.entries(tasksSnapshot.val() || {}),
    ...Object.entries(collectionsSnapshot.val() || {}),
  ].filter(([, task]) => (
    task
    && normalize(task.type || task.taskType || task.category) === 'collection'
    && normalize(task.binId || task.bin || task.node || task.bin_id) === normalize(binId)
    && String(task.scheduledDate || task.date || '').slice(0, 10) === dateKey
    && !['cancelled', 'canceled'].includes(normalize(task.status))
    && (['daily', 'weekly'].includes(normalize(task.recurrence))
      || !['completed', 'complete', 'done'].includes(normalize(task.status)))
  ));
  const existingOccurrence = sameDayTasks.find(([, task]) => task.isCapacityTriggered || task.isHighGasTriggered)
    || sameDayTasks.find(([, task]) => task.isRecurringOccurrence && !['completed', 'complete', 'done'].includes(normalize(task.status)))
    || sameDayTasks.find(([, task]) => !isRecurringTemplate(task) && !['completed', 'complete', 'done'].includes(normalize(task.status)))
    || sameDayTasks.find(([, task]) => isRecurringTemplate(task));
  const occurrenceId = existingOccurrence?.[0] || generatedId;
  const taskRef = db.ref(`/tasks/${occurrenceId}`);
  const collectionRef = db.ref(`/collections/${occurrenceId}`);
  const [taskSnapshot, collectionSnapshot] = await Promise.all([taskRef.once('value'), collectionRef.once('value')]);

  const assigneeFields = [
    ...userFields,
    ...teamFields,
    'assignedUserEmail',
    'assignedUserName',
    'assignedMembers',
    'assignedUsers',
    'members',
    'teamMembers',
  ];
  const assigneeData = Object.fromEntries(assigneeFields
    .filter(field => assignment[field] !== undefined)
    .map(field => [field, assignment[field]]));
  const scheduledTime = String(assignment.scheduledTime || assignment.time || '').trim();
  const previousTask = taskSnapshot.val() || collectionSnapshot.val() || {};
  const isCapacityTriggered = alertType === 'full_bin' || previousTask.isCapacityTriggered === true;
  const isHighGasTriggered = alertType === 'high_gas' || previousTask.isHighGasTriggered === true;
  const alertDescriptions = [
    isCapacityTriggered ? 'Bin reached full capacity.' : null,
    isHighGasTriggered ? 'High gas alert.' : null,
  ].filter(Boolean);
  const occurrence = {
    ...previousTask,
    ...assigneeData,
    id: occurrenceId,
    type: 'collection',
    taskType: 'collection',
    binId,
    bin: binId,
    node: binId,
    location,
    description: `${alertDescriptions.join(' ')} Collection requested on ${dateKey}.`,
    scheduledDate: dateKey,
    date: dateKey,
    scheduledTime: /^\d{1,2}:\d{2}(\s?[ap]m)?$/i.test(scheduledTime) ? scheduledTime : '',
    status: 'pending',
    isCapacityTriggered,
    isHighGasTriggered,
    isRecurringOccurrence: false,
    capacityAlertSensorId: alertType === 'full_bin' ? String(sensorRecord.id) : previousTask.capacityAlertSensorId || null,
    highGasAlertId: alertType === 'high_gas' ? String(sensorRecord.id) : previousTask.highGasAlertId || null,
    recurrenceSourceId: previousTask.recurrenceSourceId || assignment.scheduleId || assignment.id || null,
    recurrence: null,
    createdAt: previousTask.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await db.ref('/').update({
    [`tasks/${occurrenceId}`]: occurrence,
    [`collections/${occurrenceId}`]: occurrence,
  });

  return { occurrenceId, created: !existingOccurrence && !taskSnapshot.exists() && !collectionSnapshot.exists() };
}

async function getSystemGasAlertBinId(alertId, alert) {
  const directBin = getBinId(alert);
  if (directBin) return directBin;

  const statesSnapshot = await db.ref('/systemAlertStates').once('value');
  const states = statesSnapshot.val() || {};
  const matchingState = Object.entries(states).find(([key, value]) => (
    key.startsWith('high_gas_') && value?.alertId === alertId
  ));
  if (matchingState) return matchingState[0].slice('high_gas_'.length);

  const text = `${alert?.title || ''} ${alert?.message || ''} ${alert?.body || ''}`;
  return text.match(/\bBIN[-_ ]?\d+\b/i)?.[0] || null;
}

async function notifyAssignedCollectors(binId, sensorRecord) {
  const assignments = await getCollectionAssignmentsForBin(binId);
  const usersSnap = await db.ref('/users').once('value');
  const users = usersSnap.val() || {};
  const location = sensorRecord.location || sensorRecord.address || 'Location unavailable';
  const dateKey = getAppDateKey(getRecordTime(sensorRecord) || Date.now());
  const selectedAssignment = chooseCollectionAssignmentForDate(assignments, dateKey);
  const collectionOccurrence = selectedAssignment
    ? await createAlertCollectionOccurrence(binId, sensorRecord, selectedAssignment, dateKey, location, 'full_bin')
    : null;
  if (!collectionOccurrence) {
    console.log('Bin is full with no active collection assignment; broadcasting alert without a task:', binId);
  }
  const occurrenceId = collectionOccurrence?.occurrenceId || '';
  const created = collectionOccurrence?.created || false;
  const title = 'Bin at 100% capacity';
  const body = collectionOccurrence
    ? `${binId} is full at ${location}. A collection task is scheduled for ${dateKey}.`
    : `${binId} is full at ${location}. Please arrange collection.`;
  const notificationId = `bin_full_${crypto.createHash('sha256').update(`${binId}:${sensorRecord.id}`).digest('hex').slice(0, 28)}`;

  const inboxWrites = [];
  const tokens = [];
  Object.entries(users).forEach(([userId, user]) => {
    if (!user || typeof user !== 'object') return;
    inboxWrites.push(db.ref(`/users/${userId}/notifications/${notificationId}`).transaction((current) => current || ({
      type: 'bin_full',
      binId,
      ...(occurrenceId ? { taskId: occurrenceId, scheduledDate: dateKey } : {}),
      title,
      body,
      createdAt: { '.sv': 'timestamp' },
      read: false,
    })));
    if (user.allowNotifications === true && user.fcmToken) tokens.push(user.fcmToken);
  });
  await Promise.all(inboxWrites);

  const uniqueTokens = [...new Set(tokens)];
  if (!uniqueTokens.length) {
    console.log(`Saved full-bin inbox alerts for ${inboxWrites.length} users; no opted-in FCM tokens available:`, binId);
    return;
  }

  const response = await getMessaging(firebaseApp).sendEachForMulticast({
    tokens: uniqueTokens,
    notification: { title, body },
    data: { type: 'bin_full', binId: String(binId), taskId: occurrenceId, scheduledDate: dateKey },
    android: { priority: 'high', notification: { channelId: 'task-updates-v2', sound: 'default' } },
  });
  console.log(`Sent ${response.successCount}/${uniqueTokens.length} full-bin alerts to opted-in users; inbox ${inboxWrites.length}${occurrenceId ? `; collection ${occurrenceId} (${created ? 'created' : 'already existed'}) scheduled ${dateKey}` : ''}`);
  response.responses.forEach((result, index) => {
    if (!result.success) console.warn('Full-bin notification failed for token index', index, result.error?.toString());
  });
}

async function notifyAllUsersForHighGas(binId, sensorRecord, highGasMeasurements) {
  const usersSnap = await db.ref('/users').once('value');
  const users = usersSnap.val() || {};
  const location = sensorRecord.location || sensorRecord.address || 'Location unavailable';
  const dateKey = getAppDateKey(getRecordTime(sensorRecord) || Date.now());
  const assignments = await getCollectionAssignmentsForBin(binId);
  const selectedAssignment = chooseCollectionAssignmentForDate(assignments, dateKey);
  const collectionOccurrence = selectedAssignment
    ? await createAlertCollectionOccurrence(binId, sensorRecord, selectedAssignment, dateKey, location, 'high_gas')
    : null;
  const readings = highGasMeasurements.map(([sensor, value]) => `${sensor.toUpperCase()} ${value}`).join(', ');
  const title = 'High gas level detected';
  const body = `${readings} at ${binId}, ${location}. ${collectionOccurrence ? `A collection task is scheduled for ${dateKey}.` : 'Please check the bin area.'}`;
  const notificationId = `high_gas_${crypto.createHash('sha256').update(`${binId}:${sensorRecord.id}`).digest('hex').slice(0, 28)}`;
  const inboxWrites = [];
  const tokens = [];

  Object.entries(users).forEach(([userId, user]) => {
    if (!user || typeof user !== 'object') return;
    inboxWrites.push(db.ref(`/users/${userId}/notifications/${notificationId}`).transaction((current) => current || ({
      type: 'high_gas',
      binId,
      ...(collectionOccurrence ? { taskId: collectionOccurrence.occurrenceId, scheduledDate: dateKey } : {}),
      title,
      body,
      gasReadings: Object.fromEntries(highGasMeasurements),
      createdAt: { '.sv': 'timestamp' },
      read: false,
    })));
    if (user.allowNotifications === true && user.fcmToken) tokens.push(user.fcmToken);
  });

  await Promise.all(inboxWrites);
  const uniqueTokens = [...new Set(tokens)];
  if (!uniqueTokens.length) {
    console.log(`Saved high-gas inbox alerts for ${Object.keys(users).length} users; no opted-in FCM tokens available`);
    return;
  }

  for (let index = 0; index < uniqueTokens.length; index += 500) {
    const chunk = uniqueTokens.slice(index, index + 500);
    const response = await getMessaging(firebaseApp).sendEachForMulticast({
      tokens: chunk,
      notification: { title, body },
      data: {
        type: 'high_gas',
        binId: String(binId),
        taskId: collectionOccurrence?.occurrenceId || '',
        scheduledDate: collectionOccurrence ? dateKey : '',
      },
      android: { priority: 'high', notification: { channelId: 'task-updates-v2', sound: 'default' } },
    });
    console.log(`Sent ${response.successCount}/${chunk.length} high-gas alerts for ${binId}`);
    response.responses.forEach((result, responseIndex) => {
      if (!result.success) console.warn('High-gas notification failed for token index', index + responseIndex, result.error?.toString());
    });
  }
  console.log(`High-gas alert for ${binId}; ${collectionOccurrence ? `collection ${collectionOccurrence.occurrenceId} (${collectionOccurrence.created ? 'created' : 'already existed'}) scheduled ${dateKey}` : 'no assigned collection task created'}`);
}

async function processHighGasRecord(binId, sensorRecord) {
  const recordTime = getRecordTime(sensorRecord);
  if (!recordTime || Date.now() - recordTime > gasAlertMaxAgeMs) {
    console.log('Skipping stale or undated gas reading for bin:', binId);
    return;
  }

  const highGasMeasurements = getHighGasMeasurements(sensorRecord);
  const stateRef = db.ref(`/notificationState/highGas/${normalize(binId).replace(/[.#$/[\]]/g, '_')}`);
  if (!highGasMeasurements.length) {
    await stateRef.transaction((current) => current?.isHighGas ? ({ isHighGas: false, updatedAt: { '.sv': 'timestamp' } }) : current);
    return;
  }

  const stateResult = await stateRef.transaction((current) => {
    if (current?.isHighGas) return;
    return {
      isHighGas: true,
      episodeId: sensorRecord.id,
      updatedAt: { '.sv': 'timestamp' },
    };
  });
  if (!stateResult.committed) return;

  console.log('High gas threshold reached for bin:', binId, highGasMeasurements);
  await notifyAllUsersForHighGas(binId, sensorRecord, highGasMeasurements);
}

async function notifyAllUsersForSystemGasAlert(alertId, alert) {
  if (!alert || alert.type !== 'sensor_high_gas') return;

  const stateRef = db.ref(`/notificationState/systemAlerts/${alertId}`);
  const claim = await stateRef.transaction((current) => {
    const leaseExpired = current?.status === 'sending' && Date.now() - Number(current.startedAt || 0) > 2 * 60 * 1000;
    if (current?.status === 'sent' || (current?.status === 'sending' && !leaseExpired)) return;
    return { status: 'sending', startedAt: Date.now() };
  });
  if (!claim.committed) return;

  const usersSnap = await db.ref('/users').once('value');
  const users = usersSnap.val() || {};
  const binId = await getSystemGasAlertBinId(alertId, alert);
  const assignments = binId ? await getCollectionAssignmentsForBin(binId) : [];
  const dateKey = getAppDateKey(Date.parse(alert.createdAt || '') || Date.now());
  const selectedAssignment = chooseCollectionAssignmentForDate(assignments, dateKey);
  const alertSensorRecord = {
    id: alertId,
    node: binId || '',
    location: alert.location || alert.address || 'Location unavailable',
    timestamp: alert.createdAt || Date.now(),
  };
  const collectionOccurrence = binId && selectedAssignment
    ? await createAlertCollectionOccurrence(binId, alertSensorRecord, selectedAssignment, dateKey, alertSensorRecord.location, 'high_gas')
    : null;
  const title = alert.title || 'High gas level detected';
  const originalBody = alert.message || alert.body || 'A high gas level has been detected. Please check the bins immediately.';
  const body = collectionOccurrence
    ? `${originalBody} A collection task is scheduled for ${dateKey}.`
    : originalBody;
  const notificationId = `system_alert_${alertId}`;
  const inboxWrites = [];
  const tokens = [];

  if (collectionOccurrence) {
    await Promise.all(Object.entries(users).map(([userId, user]) => {
      const inboxItemRef = db.ref(`/users/${userId}/notifications/${notificationId}`);
      return inboxItemRef.transaction((current) => current && ({
        ...current,
        binId: binId || current.binId || null,
        taskId: collectionOccurrence.occurrenceId,
        scheduledDate: dateKey,
      }));
    }));
  }

  Object.entries(users).forEach(([userId, user]) => {
    if (!user || typeof user !== 'object') return;
    inboxWrites.push(db.ref(`/users/${userId}/notifications/${notificationId}`).transaction((current) => current || ({
      type: 'high_gas',
      alertId,
      binId: binId || null,
      ...(collectionOccurrence ? { taskId: collectionOccurrence.occurrenceId, scheduledDate: dateKey } : {}),
      title,
      body,
      createdAt: alert.createdAt || { '.sv': 'timestamp' },
      read: false,
    })));
    if (user.allowNotifications === true && user.fcmToken) tokens.push(user.fcmToken);
  });

  try {
    await Promise.all(inboxWrites);
    const uniqueTokens = [...new Set(tokens)];
    let sentCount = 0;
    for (let index = 0; index < uniqueTokens.length; index += 500) {
      const chunk = uniqueTokens.slice(index, index + 500);
      const response = await getMessaging(firebaseApp).sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        data: {
          type: 'high_gas',
          alertId: String(alertId),
          binId: binId || '',
          taskId: collectionOccurrence?.occurrenceId || '',
          scheduledDate: collectionOccurrence ? dateKey : '',
        },
        android: { priority: 'high', notification: { channelId: 'task-updates-v2', sound: 'default' } },
      });
      sentCount += response.successCount;
      response.responses.forEach((result, responseIndex) => {
        if (!result.success) console.warn('System high-gas push failed for token index', index + responseIndex, result.error?.toString());
      });
    }

    await stateRef.update({ status: 'sent', sentAt: { '.sv': 'timestamp' }, inboxCount: inboxWrites.length, pushCount: sentCount });
    console.log(`Broadcast system high-gas alert ${alertId}: inbox ${inboxWrites.length}, push ${sentCount}/${new Set(tokens).size}${collectionOccurrence ? `, collection ${collectionOccurrence.occurrenceId} (${collectionOccurrence.created ? 'created' : 'already existed'}) scheduled ${dateKey}` : ', no assigned collection task created'}`);
  } catch (error) {
    await stateRef.update({ status: 'failed', failedAt: { '.sv': 'timestamp' }, error: String(error?.message || error) });
    throw error;
  }
}

async function deliverLatestExistingSystemGasAlert() {
  const snapshot = await systemAlertsRef.once('value');
  const alerts = snapshot.val() || {};
  const latest = Object.entries(alerts)
    .filter(([, alert]) => alert?.type === 'sensor_high_gas')
    .sort(([, first], [, second]) => Date.parse(second.createdAt || 0) - Date.parse(first.createdAt || 0))[0];
  if (!latest) return;

  const [alertId, alert] = latest;
  const stateRef = db.ref(`/notificationState/systemAlerts/${alertId}`);
  const broadcastState = (await stateRef.once('value')).val();
  if (broadcastState?.status === 'sent') {
    const binId = await getSystemGasAlertBinId(alertId, alert);
    if (!binId) return;
    const dateKey = getAppDateKey(Date.parse(alert.createdAt || '') || Date.now());
    const assignments = await getCollectionAssignmentsForBin(binId);
    const assignment = chooseCollectionAssignmentForDate(assignments, dateKey);
    if (!assignment) return;

    const collectionOccurrence = await createAlertCollectionOccurrence(
      binId,
      { id: alertId, timestamp: alert.createdAt || Date.now() },
      assignment,
      dateKey,
      alert.location || alert.address || 'Location unavailable',
      'high_gas',
    );
    const users = (await db.ref('/users').once('value')).val() || {};
    await Promise.all(Object.entries(users).map(([userId, user]) => {
      if (!user || typeof user !== 'object') return null;
      const inboxRef = db.ref(`/users/${userId}/notifications/system_alert_${alertId}`);
      return inboxRef.transaction(current => current && ({
        ...current,
        binId,
        taskId: collectionOccurrence.occurrenceId,
        scheduledDate: dateKey,
      }));
    }));
    console.log(`Linked existing system gas alert ${alertId} to collection ${collectionOccurrence.occurrenceId}; no repeat push sent.`);
    return;
  }

  await notifyAllUsersForSystemGasAlert(alertId, alert);
}

function watchSystemAlerts() {
  const seenAlertIds = new Set();
  systemAlertsRef.once('value').then(snapshot => {
    Object.keys(snapshot.val() || {}).forEach(alertId => seenAlertIds.add(alertId));
    systemAlertsRef.on('child_added', alertSnapshot => {
      const alertId = alertSnapshot.key;
      if (seenAlertIds.has(alertId)) return;
      seenAlertIds.add(alertId);
      notifyAllUsersForSystemGasAlert(alertId, alertSnapshot.val()).catch(error => {
        console.error('Could not broadcast system alert', alertId, error?.message || error);
      });
    }, error => console.error('System alert listener error', error));
  }).catch(error => console.error('Could not initialize system alert listener', error));
}

async function processSensorRecord(binId, sensorRecord) {
  const stateRef = db.ref(`/notificationState/binCapacity/${normalize(binId).replace(/[.#$/[\]]/g, '_')}`);
  const isFull = getBinFullState(sensorRecord);
    const recordTime = getRecordTime(sensorRecord);
    if (!recordTime || Date.now() - recordTime > gasAlertMaxAgeMs || recordTime - Date.now() > 60 * 1000) {
      console.log('Skipping stale or undated capacity reading for bin:', binId);
      return;
    }
  if (!isFull) {
    await stateRef.transaction((current) => current?.isFull ? ({ isFull: false, updatedAt: { '.sv': 'timestamp' } }) : current);
    return;
  }

  const episodeId = `${sensorRecord.id}_${Date.now()}`;
  const stateResult = await stateRef.transaction((current) => {
    if (current?.isFull) return;
    return { isFull: true, episodeId, updatedAt: { '.sv': 'timestamp' } };
  });
  if (!stateResult.committed) return;

  console.log('Full capacity detected for bin:', binId);
  await notifyAssignedCollectors(binId, { ...sensorRecord, id: episodeId });
}

function watchSensorPath(sensorPath) {
  db.ref(`/${sensorPath}`).on('value', (snapshot) => {
    const latestByBin = getLatestSensorRecords(snapshot.val());
    latestByBin.forEach((record, binId) => {
      const previous = latestSensorByBin.get(binId);
      if (previous && getRecordTime(record) < getRecordTime(previous)) return;
      if (previous && record.id === previous.id) return;
      latestSensorByBin.set(binId, record);
      Promise.all([
        processSensorRecord(binId, record),
        processHighGasRecord(binId, record),
      ]).catch((error) => {
        console.error('Could not process sensor alerts for', binId, error?.message || error);
      });
    });
  }, (error) => console.error(`Sensor listener error at /${sensorPath}`, error));
}

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
  const assignmentKey = getAssignmentKey(task);
  const notificationId = `task_${crypto.createHash('sha256').update(`${taskId}:${assignmentKey}`).digest('hex').slice(0, 32)}`;
  const taskType = getTaskType(task);
  const title = taskType ? `${taskType} task assigned` : 'New task assigned';
  const taskTitle = task.title || task.name || task.binId || task.bin || null;
  const taskDetails = task.description || task.body;
  const body = taskDetails
    ? (taskTitle ? `${taskTitle}: ${taskDetails}` : taskDetails)
    : (taskTitle || 'A new task has been assigned to you.');
  const inboxWrites = [];
  Object.entries(users).forEach(([userId, user]) => {
    if (!user || typeof user !== 'object') return;
    const userTeams = [...teamFields, 'teams', 'teamNames', 'teamIds', 'groups']
      .flatMap((field) => valuesFrom(user[field])).map(normalize);
    const userIdentities = [userId, user.uid, user.id, user.employeeId, user.email].map(normalize);
    const matches = userTeams.some((team) => assignments.teams.includes(team))
      || userIdentities.some((identity) => assignments.users.includes(identity));
    if (!matches) return;
    inboxWrites.push(db.ref(`/users/${userId}/notifications/${notificationId}`).transaction(current => ({
      ...(current || {}),
      type: 'task_assigned',
      taskType: taskType || current?.taskType || null,
      taskId: String(taskId),
      title,
      body,
      createdAt: current?.createdAt || { '.sv': 'timestamp' },
      read: current?.read || false,
    })));
    if (user.allowNotifications !== true) return;
    if (user.fcmToken) tokens.push(user.fcmToken);
    else matchedWithoutToken.push(userId);
  });

  await Promise.all(inboxWrites);

  const uniqueTokens = [...new Set(tokens)];
  if (!uniqueTokens.length) {
    console.log('Saved inbox notices; no opted-in FCM tokens matched task assignment', taskId, assignments);
    if (matchedWithoutToken.length) {
      console.log('Matched users without fcmToken:', matchedWithoutToken);
    } else {
      console.log('No users matched task assignment', taskId);
    }
    return;
  }

  const message = {
    notification: { title, body },
    data: { taskId: String(taskId), type: 'task_assigned' },
    android: { priority: 'high', notification: { channelId: 'task-updates-v2' } },
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
  if (isRecurringTemplate(task) || task?.isRecurringOccurrence || task?.isCapacityTriggered) {
    console.log('System-generated collection occurrence created; skipping duplicate assignment push:', taskId);
    return;
  }
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
    if (isRecurringTemplate(task) || task?.isRecurringOccurrence || task?.isCapacityTriggered) {
      console.log('Recurring template or system-generated task changed; skipping assignment push:', taskId);
      return;
    }
    await sendNotificationsForTask(taskId, task);
  } else {
    console.log('Task changed without assignment change; skipping:', taskId);
  }
}

async function main() {
  await removeGeneratedRecurrenceOccurrences();
  await loadExistingTasks();
  await deliverLatestExistingSystemGasAlert();

  tasksRef.on('child_added', handleChildAdded, (err) => console.error('child_added listener error', err));
  tasksRef.on('child_changed', handleChildChanged, (err) => console.error('child_changed listener error', err));

  sensorPaths.forEach(watchSensorPath);
  watchSystemAlerts();

  console.log(`Listening for task assignments, full-bin alerts, gas readings (raw threshold ${gasAlertThreshold}), and system high-gas alerts...`);
}

main().catch(err => {
  console.error('Fatal error', err);
  process.exit(1);
});
