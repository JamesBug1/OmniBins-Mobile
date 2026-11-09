import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  LayoutAnimation,
  Platform,
  UIManager,
  Dimensions,
  Alert,
} from 'react-native';
import { CalendarIcon, SimpleBinIcon } from '../Components/Icons';
import { getTaskLocation } from '../Components/taskLocation';
import { getTaskSafetyIssues } from '../Components/taskSafety';
import { auth, db } from '../firebaseConfig';
import { ref, onValue, update, get } from 'firebase/database';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const PRIMARY_GREEN = '#00a63e';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const formatDateKey = (dateValue) => {
  if (!dateValue) return null;

  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

const getTaskDateValue = (task) => {
  if (!task || typeof task !== 'object') return null;
  return task.date || task.scheduledDate || task.scheduleDate || task.taskDate || task.dateTime || task.timestamp || task.createdAt || null;
};

const formatTaskTime = (task) => {
  if (!task || typeof task !== 'object') return '—';
  const time = task.time || task.scheduledTime || task.taskTime || task.slot || null;
  if (!time) return '—';
  return time;
};

const syncCollectionStatus = async (task, nextStatus) => {
  if (!task || typeof task !== 'object') return 0;

  const taskId = task.id || task.taskId || task.taskKey;
  const binId = task.binId || task.bin || task.bin_id || task.binID || task.locationId;
  const scheduleDate = task.date || task.scheduledDate || task.scheduleDate || task.taskDate || task.dateTime || task.timestamp || task.createdAt;
  const taskType = normalizeValue(task.type || task.taskType || task.category);

  const collectionsSnap = await get(ref(db, 'collections'));
  const collections = collectionsSnap.val() || {};
  let updatedCount = 0;

  await Promise.all(Object.entries(collections).map(async ([collectionId, collection]) => {
    if (!collection || typeof collection !== 'object') return;

    const collectionTaskId = collection.taskId || collection.task_id || collection.task || collection.parentTaskId || collection.taskRef;
    const collectionDate = collection.date || collection.scheduledDate || collection.scheduleDate || collection.taskDate || collection.dateTime || collection.timestamp || collection.createdAt;
    const matchesByTask = !!taskId && (
      normalizeValue(collectionId) === normalizeValue(taskId)
      || (!!collectionTaskId && normalizeValue(taskId) === normalizeValue(collectionTaskId))
    );
    const collectionBinId = collection.binId || collection.bin || collection.bin_id || collection.binID || collection.locationId;
    const collectionType = normalizeValue(collection.type || collection.taskType || collection.category);
    const matchesLegacyOccurrence = !collectionTaskId
      && !collection.taskId
      && !!binId
      && !!collectionBinId
      && normalizeValue(binId) === normalizeValue(collectionBinId)
      && !!scheduleDate
      && !!collectionDate
      && normalizeValue(String(scheduleDate).slice(0, 10)) === normalizeValue(String(collectionDate).slice(0, 10))
      && (!taskType || !collectionType || taskType === collectionType);

    if (!matchesByTask && !matchesLegacyOccurrence) {
      return;
    }

    await update(ref(db, `collections/${collectionId}`), {
      status: nextStatus,
      updatedAt: new Date().toISOString(),
      completedAt: nextStatus === 'completed' ? new Date().toISOString() : collection.completedAt || null,
      completedBy: {
        ...(collection.completedBy || {}),
        [auth?.currentUser?.uid || 'unknown-user']: true,
      },
    });
    updatedCount += 1;
  }));

  return updatedCount;
};

const normalizeValue = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim().toLowerCase();
};

const isMaintenanceTask = (task) => {
  const taskType = normalizeValue(
    task?.type || task?.taskType || task?.category || task?.taskCategory || task?.task_type || task?.serviceType,
  ).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  return taskType === 'maintenance' || taskType === 'maintenance task';
};

const getArrayValues = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'object') return Object.values(value);
  return [value];
};

const extractMembersFromTeam = (team) => {
  if (!team || typeof team !== 'object') return new Set();
  const values = [];
  const memberFields = ['members', 'memberIds', 'memberEmails', 'staff', 'staffMembers', 'users', 'userIds', 'teamMembers', 'assignees'];

  memberFields.forEach((field) => {
    values.push(...getArrayValues(team[field]));
  });

  if (team.member && typeof team.member === 'object') {
    values.push(...Object.values(team.member));
  }

  const members = new Set();
  values.forEach((member) => {
    if (!member || typeof member === 'object') {
      if (member && typeof member === 'object') {
        const nested = [member.uid, member.id, member.employeeId, member.email, member.userId, member.userEmail, member.name];
        nested.forEach((value) => {
          if (value) members.add(normalizeValue(value));
        });
      }
      return;
    }

    members.add(normalizeValue(member));
  });

  return members;
};

const getCurrentUserIdentitySet = (currentUserRecord) => {
  const currentUser = auth?.currentUser;
  return new Set([
    normalizeValue(currentUser?.uid),
    normalizeValue(currentUserRecord?.uid),
    normalizeValue(currentUserRecord?.id),
    normalizeValue(currentUserRecord?.employeeId),
    normalizeValue(currentUser?.email),
    normalizeValue(currentUserRecord?.email),
  ]);
};

const getUserTeamNames = (currentUserRecord, teamsData = {}) => {
  const names = new Set();
  const currentUser = auth?.currentUser;
  const currentIdentity = getCurrentUserIdentitySet(currentUserRecord);

  const addValue = (value) => {
    if (value) names.add(normalizeValue(value));
  };

  const directFields = [
    currentUserRecord?.team,
    currentUserRecord?.teamName,
    currentUserRecord?.teamId,
    currentUserRecord?.group,
    currentUserRecord?.groupName,
    currentUserRecord?.assignedTeam,
    currentUserRecord?.department,
    currentUserRecord?.teamNames,
    currentUserRecord?.teams,
    currentUserRecord?.teamIds,
    currentUserRecord?.groups,
  ];

  directFields.forEach((field) => {
    if (Array.isArray(field)) {
      field.forEach(addValue);
      return;
    }
    addValue(field);
  });

  Object.values(teamsData).forEach((team) => {
    if (!team || typeof team !== 'object') return;
    const memberSet = extractMembersFromTeam(team);
    const matchesThisTeam = Array.from(memberSet).some((member) => currentIdentity.has(member));
    if (!matchesThisTeam) return;

    addValue(team.name);
    addValue(team.teamName);
    addValue(team.teamId);
    addValue(team.id);
    addValue(team.key);
  });

  return names;
};

const getTaskTeamMembers = (task, teamsData = {}) => {
  if (!task || typeof task !== 'object') return new Set();
  const teamNames = new Set();
  const teamIds = new Set();
  const taskMemberValues = new Set();

  const addValue = (value) => {
    if (value) {
      const normalized = normalizeValue(value);
      if (normalized) {
        teamNames.add(normalized);
        taskMemberValues.add(normalized);
      }
    }
  };

  ['assignedToTeam', 'teamName', 'team', 'team_id', 'teamId', 'assignedTeam', 'groupName', 'group'].forEach((field) => {
    addValue(task[field]);
  });

  getArrayValues(task.assignedMembers).forEach((member) => addValue(member));
  getArrayValues(task.members).forEach((member) => addValue(member));
  getArrayValues(task.assignedUsers).forEach((member) => addValue(member));
  getArrayValues(task.teamMembers).forEach((member) => addValue(member));

  if (task.completedBy && typeof task.completedBy === 'object') {
    Object.keys(task.completedBy).forEach((member) => addValue(member));
  }

  if (task.assignedTo && typeof task.assignedTo === 'object') {
    Object.values(task.assignedTo).forEach((value) => addValue(value));
  }

  Object.entries(teamsData).forEach(([id, team]) => {
    if (!team || typeof team !== 'object') return;
    const teamNameValues = [team.name, team.teamName, team.teamId, team.id, id];
    const matchesTask = teamNameValues.some((value) => teamNames.has(normalizeValue(value)));
    if (!matchesTask) return;

    const members = extractMembersFromTeam(team);
    members.forEach((member) => {
      taskMemberValues.add(member);
    });
    teamIds.add(normalizeValue(id));
  });

  const directIdentityFields = [
    task.assignedTo,
    task.assignedToUid,
    task.assignedUserId,
    task.assigneeId,
    task.staffId,
    task.userId,
    task.uid,
    task.workerId,
    task.employeeId,
    task.assignedEmail,
    task.email,
    task.assignedStaff,
    task.ownerId,
    task.createdBy,
  ];

  directIdentityFields.forEach((value) => {
    if (value) taskMemberValues.add(normalizeValue(value));
  });

  return taskMemberValues;
};

const getTaskStatus = (task, currentUserRecord, teamsData = {}) => {
  if (!task || typeof task !== 'object') return 'Pending';

  const keyStatus = normalizeValue(task.status || '');
  if (keyStatus === 'completed' || keyStatus === 'done' || keyStatus === 'finished') {
    return 'Completed';
  }

  const assignedMembers = getTaskTeamMembers(task, teamsData);
  const completedBy = task.completedBy || task.completions || task.teamCompletion || task.completedMembers || {};
  const completedValues = new Set();

  Object.entries(completedBy).forEach(([memberKey, value]) => {
    if (value) completedValues.add(normalizeValue(memberKey));
  });

  if (typeof completedBy === 'object') {
    Object.values(completedBy).forEach((value) => {
      if (value && typeof value === 'object') {
        Object.keys(value).forEach((memberKey) => {
          completedValues.add(normalizeValue(memberKey));
        });
      }
    });
  }

  if (assignedMembers.size === 0) {
    return keyStatus === 'pending' ? 'Pending' : 'Pending';
  }

  const allCompleted = Array.from(assignedMembers).every((member) => completedValues.has(member));
  if (allCompleted && assignedMembers.size > 0) {
    return 'Completed';
  }

  return 'Pending';
};

const matchesCurrentUserTask = (task, currentUserRecord, teamsData = {}) => {
  if (!task || typeof task !== 'object') return false;
  const currentUser = auth?.currentUser;
  if (!currentUser && !currentUserRecord) return false;

  const currentValues = getCurrentUserIdentitySet(currentUserRecord);
  const userTeams = getUserTeamNames(currentUserRecord, teamsData);
  const taskMembers = getTaskTeamMembers(task, teamsData);

  if (Array.from(taskMembers).some((value) => currentValues.has(value))) {
    return true;
  }

  const teamAssignmentValues = [
    task.assignedToTeam,
    task.teamName,
    task.team,
    task.team_id,
    task.teamId,
    task.assignedTeam,
    task.groupName,
    task.group,
  ].filter(Boolean);

  const matchesAssignedTeam = teamAssignmentValues.some((value) => userTeams.has(normalizeValue(value)));
  if (matchesAssignedTeam) return true;

  const currentEmail = normalizeValue(currentUser?.email || currentUserRecord?.email);
  const taskEmail = normalizeValue(task.assignedEmail || task.email || task.staffEmail || task.userEmail);
  if (currentEmail && taskEmail && currentEmail === taskEmail) {
    return true;
  }

  const taskValues = [
    task.assignedTo,
    task.assignedToUid,
    task.assignedUserId,
    task.assigneeId,
    task.staffId,
    task.userId,
    task.uid,
    task.workerId,
    task.employeeId,
    task.assignedEmail,
    task.email,
    task.assignedStaff,
    task.ownerId,
    task.createdBy,
  ];

  const normalizedTaskValues = taskValues.map(normalizeValue);
  if (normalizedTaskValues.some((value) => currentValues.has(value) && value)) {
    return true;
  }

  return false;
};

const SchedulePage = () => {
  const [selectedDate, setSelectedDate] = useState(() => formatDateKey(new Date()) || 'Sep 6, 2026');
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(new Date().getMonth());
  const [viewDay, setViewDay] = useState(new Date().getDate());
  const [viewYear, setViewYear] = useState(new Date().getFullYear());
  const [currentView, setCurrentView] = useState('grid');
  const [yearPageStart, setYearPageRange] = useState(Math.floor(new Date().getFullYear() / 12) * 12);
  const [tasks, setTasks] = useState([]);
  const [currentUserRecord, setCurrentUserRecord] = useState(null);
  const [teamsData, setTeamsData] = useState({});
  const [sensorRecords, setSensorRecords] = useState([]);
  const [allUsers, setAllUsers] = useState({});

  useEffect(() => {
    const currentUser = auth?.currentUser;
    if (!currentUser) {
      setCurrentUserRecord(null);
      setTeamsData({});
      setAllUsers({});
      return;
    }

    let mounted = true;

    const loadCurrentUserRecord = async () => {
      try {
        const [usersSnap, teamsSnap] = await Promise.all([
          get(ref(db, 'users')),
          get(ref(db, 'teams')),
        ]);

        const users = usersSnap.val() || {};
        const teams = teamsSnap.val() || {};
        if (!mounted) return;

        setAllUsers(users);
        setTeamsData(teams);

        const emailLower = (currentUser.email || '').toLowerCase();
        const match = Object.entries(users).find(([, value]) => {
          if (!value || typeof value !== 'object') return false;
          return (value.email || '').toLowerCase() === emailLower;
        });

        if (match && mounted) {
          const [id, record] = match;
          setCurrentUserRecord({ id, ...record });
          return;
        }

        setCurrentUserRecord({ id: currentUser.uid, uid: currentUser.uid, email: currentUser.email });
      } catch (e) {
        console.warn('Failed to load signed-in user record', e?.message || e);
      }
    };

    loadCurrentUserRecord();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!auth?.currentUser || !currentUserRecord) return;

    const tasksRef = ref(db, 'tasks');
    const unsubscribe = onValue(tasksRef, (snapshot) => {
      const raw = snapshot.val();
      const list = raw && typeof raw === 'object'
        ? Object.entries(raw)
            .map(([id, value]) => ({ id, ...value }))
            .filter((task) => task.isCapacityTriggered || (!task.recurrence && !task.isRecurringOccurrence))
            .filter((task) => matchesCurrentUserTask(task, currentUserRecord, teamsData))
        : [];
      setTasks(list);
    }, (error) => {
      console.warn('Failed to load task schedule', error?.message || error);
      Alert.alert('Schedule Error', 'Could not load tasks from the database.');
    });

    return () => unsubscribe && unsubscribe();
  }, [currentUserRecord, teamsData]);

  useEffect(() => {
    const sensorPaths = ['sensor_data1', 'sensor_data2'];
    const recordsByPath = new Map();
    const unsubscribers = sensorPaths.map(sensorPath => onValue(
      ref(db, sensorPath),
      snapshot => {
        const values = snapshot.val() || {};
        recordsByPath.set(sensorPath, Object.entries(values).map(([id, record]) => ({ id, ...(record || {}) })));
        setSensorRecords(Array.from(recordsByPath.values()).flat());
      },
      error => console.warn(`Could not load ${sensorPath} locations`, error?.message || error),
    ));

    return () => unsubscribers.forEach(unsubscribeSensorPath => unsubscribeSensorPath());
  }, []);

  const scheduleData = tasks
    .filter((task) => {
      const taskDate = getTaskDateValue(task);
      const taskDateKey = formatDateKey(taskDate);
      if (!taskDateKey) return false;
      return taskDateKey === selectedDate;
    })
    .map((task) => ({
      id: task.binId || task.bin || task.taskId || task.id || 'BIN',
      location: getTaskLocation(task, sensorRecords) || task.binId || task.bin || 'Unassigned location',
      time: formatTaskTime(task),
      status: getTaskStatus(task, currentUserRecord, teamsData),
      safetyIssues: isMaintenanceTask(task) ? [] : getTaskSafetyIssues(task, sensorRecords),
      taskKey: task.id,
      rawTask: task,
    }));

  const markTaskDone = async (taskKey) => {
    if (!taskKey) return;
    try {
      const taskRef = ref(db, `tasks/${taskKey}`);
      const taskSnap = await get(taskRef);
      const task = taskSnap.val();
      if (!task) {
        Alert.alert('Task not found', 'This task could not be found in the database.');
        return;
      }

      const binId = task.binId || task.bin || task.bin_id || task.binID || task.node || task.locationId;
      if (binId && !isMaintenanceTask(task)) {
        const binSnapshot = await get(ref(db, `bins/${binId}`));
        const binConfig = binSnapshot.val() || {};
        const configuredSensorPath = binConfig.sensorDataPath || binConfig.sensorDataName;
        const sensorPathMatch = String(configuredSensorPath || '').match(/^sensor_data\d+$/i);
        const binNumberMatch = String(binId).match(/^BIN[-_ ]?(\d+)$/i);
        const sensorPath = sensorPathMatch?.[0] || (binNumberMatch ? `sensor_data${binNumberMatch[1]}` : null);

        if (!sensorPath) {
          Alert.alert('Cannot finish task', 'The bin sensor feed could not be identified, so its safety status cannot be checked.');
          return;
        }

        const sensorSnapshot = await get(ref(db, sensorPath));
        const latestRecords = Object.entries(sensorSnapshot.val() || {}).map(([id, record]) => ({ id, ...(record || {}) }));
        const safetyIssues = getTaskSafetyIssues(task, latestRecords, binConfig);
        if (safetyIssues.length) {
          Alert.alert('Cannot finish task yet', safetyIssues.join('\n'));
          return;
        }
      }

      const currentUser = auth?.currentUser;
      const userKey = normalizeValue(currentUser?.uid || currentUserRecord?.uid || currentUserRecord?.id || currentUserRecord?.employeeId || currentUser?.email || currentUserRecord?.email);
      const updatePayload = {
        completedBy: {
          ...(task.completedBy || task.completions || task.teamCompletion || task.completedMembers || {}),
          [currentUser?.uid || currentUserRecord?.uid || currentUserRecord?.id || currentUserRecord?.employeeId || currentUser?.email || currentUserRecord?.email]: true,
        },
        status: 'completed',
        completedAt: new Date().toISOString(),
      };

      await update(taskRef, updatePayload);
      await syncCollectionStatus(task, updatePayload.status);
      Alert.alert('Task finished', 'This task is marked completed for the team.');
    } catch (error) {
      console.warn('Failed to complete task', error?.message || error);
      Alert.alert('Task update failed', error?.message || 'Could not update the task.');
    }
  };

  const toggleCalendar = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setIsCalendarOpen(!isCalendarOpen);
    setCurrentView('grid');
  };

  const navigateView = (delta) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (currentView === 'grid') {
      let newMonth = viewMonth + delta;
      let newYear = viewYear;
      if (newMonth < 0) {
        newMonth = 11;
        newYear -= 1;
      } else if (newMonth > 11) {
        newMonth = 0;
        newYear += 1;
      }
      setViewMonth(newMonth);
      setViewYear(newYear);
    } else if (currentView === 'months') {
      setViewYear(viewYear + delta);
    } else if (currentView === 'years') {
      setYearPageRange(yearPageStart + (delta * 12));
    }
  };

  const selectDayAndClose = (day) => {
    setViewDay(day);
    const dateString = `${MONTHS[viewMonth].substring(0, 3)} ${day}, ${viewYear}`;
    setSelectedDate(dateString);
    setIsCalendarOpen(false);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  };

  const renderCalendarBody = () => {
    if (currentView === 'months') {
      return (
        <View style={[styles.gridContainer, { paddingTop: 15 }]}> 
          {MONTHS.map((m, idx) => (
            <TouchableOpacity key={m} style={styles.gridItemMonth} onPress={() => {
              setViewMonth(idx);
              setCurrentView('grid');
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            }}>
              <View style={[styles.gridCell, viewMonth === idx && styles.activeGridCell]}>
                <Text style={[styles.gridText, viewMonth === idx && styles.activeGridText]}>{m.substring(0, 3)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    if (currentView === 'years') {
      const yearArr = Array.from({ length: 12 }, (_, i) => yearPageStart + i);
      return (
        <View style={[styles.gridContainer, { paddingTop: 15 }]}> 
          {yearArr.map((y) => (
            <TouchableOpacity key={y} style={styles.gridItemYear} onPress={() => {
              setViewYear(y);
              setCurrentView('grid');
              LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            }}>
              <View style={[styles.gridCell, viewYear === y && styles.activeGridCell]}>
                <Text style={[styles.gridText, viewYear === y && styles.activeGridText]}>{y}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    const firstDayOfMonth = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysArr = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const emptySlots = Array.from({ length: firstDayOfMonth }, (_, i) => i);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
      <View style={{ flex: 1 }}>
        <View style={styles.dayNamesRow}>
          {dayNames.map(name => <Text key={name} style={styles.dayNameLabel}>{name}</Text>)}
        </View>
        <View style={styles.daysGrid}>
          {emptySlots.map(i => <View key={`empty-${i}`} style={styles.emptyDay} />)}
          {daysArr.map(day => {
            const isSelected = selectedDate === `${MONTHS[viewMonth].substring(0, 3)} ${day}, ${viewYear}`;
            return (
              <TouchableOpacity
                key={day}
                style={[styles.dayCell, isSelected && styles.selectedDayCell]}
                onPress={() => selectDayAndClose(day)}
              >
                <Text style={[styles.dayText, isSelected && styles.selectedDayText]}>{day}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {isCalendarOpen && (
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => setIsCalendarOpen(false)}
        />
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        scrollEnabled={!isCalendarOpen}
      >
        <View style={[styles.searchSection, { zIndex: isCalendarOpen ? 1000 : 1 }]}> 
          <Text style={styles.searchLabel}>Search:</Text>
          <View style={styles.dateInputContainer}>
            <TouchableOpacity
              style={styles.dateInputWrapper}
              onPress={toggleCalendar}
              activeOpacity={0.8}
            >
              <Text style={styles.dateText}>{selectedDate}</Text>
              <CalendarIcon size={20} color={isCalendarOpen ? PRIMARY_GREEN : '#636e72'} />
            </TouchableOpacity>

            {isCalendarOpen && (
              <View style={styles.calendarContainer}>
                <View style={styles.calHeader}>
                  <View style={styles.calDropdowns}>
                    <TouchableOpacity
                      style={[styles.headerBox, currentView === 'months' && styles.activeHeaderBox]}
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setCurrentView(currentView === 'months' ? 'grid' : 'months');
                      }}
                    >
                      <Text style={styles.headerSelText}>{MONTHS[viewMonth]}</Text>
                      <Text style={styles.smallChevron}>▾</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.headerBox, { marginLeft: 6 }, currentView === 'grid' && styles.activeHeaderBox]}
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setCurrentView('grid');
                      }}
                    >
                      <Text style={styles.headerSelText}>{viewDay}</Text>
                      <Text style={styles.smallChevron}>▾</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.headerBox, { marginLeft: 6 }, currentView === 'years' && styles.activeHeaderBox]}
                      onPress={() => {
                        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                        setCurrentView(currentView === 'years' ? 'grid' : 'years');
                        setYearPageRange(Math.floor(viewYear / 12) * 12);
                      }}
                    >
                      <Text style={styles.headerSelText}>{viewYear}</Text>
                      <Text style={styles.smallChevron}>▾</Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.calArrows}>
                    <TouchableOpacity style={styles.arrowBtn} onPress={() => navigateView(-1)}>
                      <Text style={styles.arrowText}>‹</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.arrowBtn, { marginLeft: 10 }]} onPress={() => navigateView(1)}>
                      <Text style={styles.arrowText}>›</Text>
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={styles.calendarBody}>
                  {renderCalendarBody()}
                </View>
              </View>
            )}
          </View>
        </View>

        <View pointerEvents={isCalendarOpen ? 'none' : 'auto'}>
          <View style={styles.tableHeader}>
            <View style={{ flex: 2.3 }}><Text style={styles.headerCol}>Bin #</Text></View>
            <View style={{ flex: 1.2, alignItems: 'center' }}><Text style={styles.headerCol}>Time</Text></View>
            <View style={{ flex: 1.2, alignItems: 'flex-end' }}><Text style={styles.headerCol}>Status</Text></View>
          </View>

          {scheduleData.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No tasks scheduled for {selectedDate}</Text>
            </View>
          ) : (
            scheduleData.map((item, index) => (
              <View key={item.taskKey || index} style={styles.scheduleItem}>
                <View style={styles.binInfoContainer}>
                  <SimpleBinIcon size={32} color={PRIMARY_GREEN} />
                  <View style={styles.binTextContainer}>
                    <Text style={styles.binId}>{item.id}</Text>
                    <Text style={styles.binLocation} numberOfLines={1}>{item.location}</Text>
                  </View>
                </View>
                <View style={styles.timeContainer}>
                  <Text style={styles.binTime}>{item.time}</Text>
                </View>
                <View style={styles.statusContainer}>
                  {item.status === 'Completed' && (
                    <View style={[styles.statusBadge, styles.doneBadge]}>
                      <Text style={[styles.statusText, styles.doneText]}>{item.status}</Text>
                    </View>
                  )}
                  {item.status !== 'Completed' && (
                    <>
                      <TouchableOpacity
                        style={[styles.doneBtn, item.safetyIssues.length > 0 && styles.blockedBtn]}
                        onPress={() => markTaskDone(item.taskKey)}
                        disabled={item.safetyIssues.length > 0}
                        accessibilityRole="button"
                        accessibilityLabel={item.safetyIssues.length ? `Finish blocked: ${item.safetyIssues[0]}` : 'Finish task'}
                      >
                        <Text style={styles.doneBtnText}>{item.safetyIssues.length > 0 ? 'Blocked' : 'Finish'}</Text>
                      </TouchableOpacity>
                      {item.safetyIssues.length > 0 && (
                        <Text style={styles.blockedHint} numberOfLines={2}>Resolve bin alert first</Text>
                      )}
                    </>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.1)', zIndex: 999 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 100 },
  searchSection: { flexDirection: 'row', alignItems: 'center', marginTop: 20, marginBottom: 20, position: 'relative' },
  searchLabel: { fontSize: 18, fontWeight: 'bold', color: '#2d3436', marginRight: 10 },
  dateInputContainer: { flex: 1, position: 'relative' },
  dateInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    borderRadius: 8,
    backgroundColor: '#ffffff',
  },
  dateText: { color: '#2d3436', fontSize: 16 },

  calendarContainer: {
    position: 'absolute',
    top: '110%',
    left: -60,
    width: SCREEN_WIDTH - 40,
    height: 380,
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 15,
    zIndex: 1000,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  calHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  calDropdowns: { flexDirection: 'row', alignItems: 'center' },
  headerBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent'
  },
  activeHeaderBox: {
    borderColor: PRIMARY_GREEN,
    backgroundColor: '#ffffff'
  },
  headerSelText: { fontSize: 14, fontWeight: 'bold', color: '#1c1c1c' },
  smallChevron: { fontSize: 10, color: '#717171', marginLeft: 4, marginTop: 2 },

  calArrows: { flexDirection: 'row', alignItems: 'center' },
  arrowBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  arrowText: { fontSize: 24, color: '#1c1c1c', fontWeight: '400', marginTop: -4 },

  calendarBody: { flex: 1 },
  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 5 },
  gridItemMonth: { width: '31%', marginBottom: 20 },
  gridItemYear: { width: '31%', marginBottom: 20 },
  gridCell: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#f8f9fa',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#f0f0f0'
  },
  activeGridCell: {
    backgroundColor: PRIMARY_GREEN,
    borderColor: PRIMARY_GREEN,
  },
  activeGridText: { color: '#ffffff', fontWeight: 'bold' },

  dayNamesRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  dayNameLabel: { width: '14.28%', textAlign: 'center', color: '#b2bec3', fontSize: 12, fontWeight: '500' },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.28%', height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  emptyDay: { width: '14.28%', height: 40 },
  dayText: { fontSize: 16, color: '#2d3436', fontWeight: '500' },
  selectedDayCell: { backgroundColor: PRIMARY_GREEN, borderRadius:12 },
  selectedDayText: { color: '#ffffff', fontWeight: 'bold' },

  tableHeader: { flexDirection: 'row', marginBottom: 15, paddingHorizontal: 15 },
  headerCol: { fontSize: 16, fontWeight: 'bold', color: '#1c1c1c' },
  scheduleItem: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 16, padding: 15, marginBottom: 12,
    borderWidth: 1, borderColor: '#f0f0f0', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8,
  },
  binInfoContainer: { flex: 2.3, flexDirection: 'row', alignItems: 'center' },
  binTextContainer: { marginLeft: 12, flex: 1 },
  binId: { fontSize: 16, fontWeight: 'bold', color: '#1c1c1c' },
  binLocation: { fontSize: 12, color: '#717171', marginTop: 2 },
  timeContainer: { flex: 1.2, alignItems: 'center' },
  binTime: { fontSize: 14, color: '#1c1c1c', fontWeight: '500' },
  statusContainer: { flex: 1.4, alignItems: 'flex-end' },
  statusBadge: { backgroundColor: '#fffbeb', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#fef3c7' },
  statusText: { color: '#b45309', fontSize: 12, fontWeight: 'bold' },
  doneBadge: { backgroundColor: '#ecfdf5', borderColor: '#bbf7d0' },
  doneText: { color: '#166534' },
  doneBtn: {
    marginTop: 8,
    backgroundColor: PRIMARY_GREEN,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  blockedBtn: {
    backgroundColor: '#9ca3af',
  },
  doneBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: 'bold',
  },
  blockedHint: {
    color: '#b91c1c',
    fontSize: 9,
    textAlign: 'right',
    marginTop: 3,
  },
  emptyState: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  emptyStateText: {
    color: '#717171',
    fontSize: 14,
  },
});

export default SchedulePage;
