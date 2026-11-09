const normalizeId = value => String(value || '').trim().toLowerCase().replace(/[-_\s]/g, '');

const getLocationLabel = record => {
  const value = record?.location;
  const candidates = [
    record?.address,
    record?.locationName,
    typeof value === 'string' ? value : null,
    value?.name,
    value?.address,
    value?.label,
    record?.site,
    record?.place,
    record?.landmark,
    record?.street,
    record?.barangay,
  ];

  return candidates.find(candidate => typeof candidate === 'string' && candidate.trim()) || null;
};

export const getTaskLocation = (task, sensorRecords = []) => {
  const directLocation = getLocationLabel(task);
  if (directLocation) return directLocation;

  const taskBinId = normalizeId(task?.binId || task?.bin || task?.bin_id || task?.binID || task?.node || task?.locationId);
  if (!taskBinId) return null;

  const matchingRecords = sensorRecords
    .filter(record => normalizeId(record?.node || record?.binId || record?.bin_id || record?.binID || record?.bin) === taskBinId)
    .sort((first, second) => {
      const firstTime = Date.parse(first?.timestamp || first?.updatedAt || first?.createdAt || '') || 0;
      const secondTime = Date.parse(second?.timestamp || second?.updatedAt || second?.createdAt || '') || 0;
      return secondTime - firstTime;
    });

  return matchingRecords.map(getLocationLabel).find(Boolean) || null;
};