export const GAS_ALERT_THRESHOLD = 1000;
export const DEFAULT_MAX_BIN_WEIGHT = 50;
export const MAX_SENSOR_AGE_MS = 15 * 60 * 1000;

const normalize = value => String(value ?? '').trim().toLowerCase();
const normalizeBinId = value => normalize(value).replace(/[-_\s]/g, '');

const getSensorTimestamp = record => {
  const value = record?.timestamp || record?.updatedAt || record?.createdAt;
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getLatestTaskSensorRecord = (task, sensorRecords = []) => {
  const binId = normalizeBinId(task?.binId || task?.bin || task?.bin_id || task?.binID || task?.node || task?.locationId);
  if (!binId) return null;

  return sensorRecords
    .filter(record => normalizeBinId(record?.node || record?.binId || record?.bin_id || record?.binID || record?.bin) === binId)
    .sort((first, second) => getSensorTimestamp(second) - getSensorTimestamp(first))[0] || null;
};

const isCollectionTask = task => {
  const taskType = normalize(task?.type || task?.taskType || task?.category || task?.taskCategory);
  return taskType === 'collection' || taskType === 'collections';
};

export const getTaskSafetyIssues = (task, sensorRecords = [], binConfig = {}) => {
  const record = getLatestTaskSensorRecord(task, sensorRecords);
  if (!record) return ['No sensor reading is available for this bin.'];

  const timestamp = getSensorTimestamp(record);
  if (!timestamp || Date.now() - timestamp > MAX_SENSOR_AGE_MS || timestamp - Date.now() > 60 * 1000) {
    return ['The latest sensor reading is stale. Wait for a fresh reading before finishing.'];
  }

  const issues = [];
  const weightText = normalize(record.weight);
  const weight = Number(String(record.weight ?? '').replace(/[^0-9.+-]/g, ''));
  const emptyCollectionReading = isCollectionTask(task)
    && normalize(record.distance) === 'empty'
    && record.weight !== null
    && record.weight !== undefined
    && weightText !== ''
    && weight === 0;
  const distanceStatus = normalize(record.distance || record.status || record.state || record.fillStatus);
  const fillValues = [record.fillLevel, record.fillPercentage, record.fill_percent, record.fill, record.level];
  const isFull = /\b(full|at capacity|100%|critical full)\b/.test(distanceStatus)
    || fillValues.some(value => value !== null && value !== undefined && value !== ''
      && Number(String(value).replace('%', '').trim()) >= 100);
  if (isFull && !emptyCollectionReading) issues.push('The bin still reports full.');

  const maxWeight = Number(
    binConfig.maxWeight ?? binConfig.weightLimit ?? binConfig.weightCapacity ?? DEFAULT_MAX_BIN_WEIGHT,
  );
  const weightIsMax = ['max', 'maximum', 'full', 'overload'].includes(weightText)
    || (Number.isFinite(weight) && Number.isFinite(maxWeight) && weight >= maxWeight);
  if (weightIsMax && !emptyCollectionReading) issues.push(`The bin weight is at or above its limit (${maxWeight}).`);

  const gasSensors = [
    ['MQ-4', Number(record.mq4)],
    ['MQ-135', Number(record.mq135)],
  ];
  gasSensors.forEach(([label, value]) => {
    if (Number.isFinite(value) && value >= GAS_ALERT_THRESHOLD) {
      issues.push(`${label} gas reading is high (${value}).`);
    }
  });

  return issues;
};
