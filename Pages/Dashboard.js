import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  PermissionsAndroid,
  Platform,
} from 'react-native';
import { OrangeCleaningIcon, ClipboardCheckIcon } from '../Components/Icons';
import { auth, db } from '../firebaseConfig';
import Geolocation from 'react-native-geolocation-service';

const PRIMARY_GREEN = '#00a63e';

const getWeatherDescription = (code) => {
  if (code === 0) return { condition: 'Clear sky', icon: '☀️' };
  if ([1, 2].includes(code)) return { condition: 'Partly cloudy', icon: '🌤️' };
  if (code === 3) return { condition: 'Overcast', icon: '☁️' };
  if ([45, 48].includes(code)) return { condition: 'Foggy', icon: '🌫️' };
  if ([51, 53, 55, 56, 57].includes(code)) return { condition: 'Drizzle', icon: '🌦️' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { condition: 'Rain', icon: '🌧️' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { condition: 'Snow', icon: '🌨️' };
  if ([95, 96, 99].includes(code)) return { condition: 'Thunderstorm', icon: '⛈️' };
  return { condition: 'Current conditions', icon: '🌡️' };
};

const normalizeTaskValue = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim().toLowerCase();
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
          if (value) members.add(normalizeTaskValue(value));
        });
      }
      return;
    }

    members.add(normalizeTaskValue(member));
  });

  return members;
};

const getCurrentUserIdentitySet = (currentUserRecord) => {
  const currentUser = auth?.currentUser;
  return new Set([
    normalizeTaskValue(currentUser?.uid),
    normalizeTaskValue(currentUserRecord?.uid),
    normalizeTaskValue(currentUserRecord?.id),
    normalizeTaskValue(currentUserRecord?.employeeId),
    normalizeTaskValue(currentUser?.email),
    normalizeTaskValue(currentUserRecord?.email),
  ]);
};

const getUserTeamNames = (currentUserRecord, teamsData = {}) => {
  const names = new Set();
  const currentUser = auth?.currentUser;
  const currentIdentity = getCurrentUserIdentitySet(currentUserRecord);

  const addValue = (value) => {
    if (value) names.add(normalizeTaskValue(value));
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
    currentUser?.email,
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
  const taskMembers = new Set();

  const addValue = (value) => {
    if (value) taskMembers.add(normalizeTaskValue(value));
  };

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

  directIdentityFields.forEach(addValue);
  ['assignedToTeam', 'teamName', 'team', 'team_id', 'teamId', 'assignedTeam', 'groupName', 'group'].forEach((field) => addValue(task[field]));
  getArrayValues(task.assignedMembers).forEach(addValue);
  getArrayValues(task.members).forEach(addValue);
  getArrayValues(task.assignedUsers).forEach(addValue);
  getArrayValues(task.teamMembers).forEach(addValue);

  Object.entries(teamsData).forEach(([id, team]) => {
    if (!team || typeof team !== 'object') return;
    const taskTeamValues = [task.assignedToTeam, task.teamName, task.team, task.team_id, task.teamId, task.assignedTeam, task.groupName, task.group, team.name, team.teamName, team.teamId, team.id, id];
    const matchesTask = taskTeamValues.some((value) => value && normalizeTaskValue(value) === normalizeTaskValue(team.name || team.teamName || team.teamId || team.id || id));
    if (!matchesTask) return;

    const members = extractMembersFromTeam(team);
    members.forEach((member) => taskMembers.add(member));
  });

  return taskMembers;
};

const getTaskStatus = (task, currentUserRecord, teamsData = {}) => {
  if (!task || typeof task !== 'object') return 'Pending';
  const keyStatus = normalizeTaskValue(task.status || '');
  if (['completed', 'done', 'finished'].includes(keyStatus)) {
    return 'Completed';
  }

  const assignedMembers = getTaskTeamMembers(task, teamsData);
  const completedBy = task.completedBy || task.completions || task.teamCompletion || task.completedMembers || {};
  const completedValues = new Set();

  Object.keys(completedBy).forEach((member) => {
    if (member) completedValues.add(normalizeTaskValue(member));
  });

  if (assignedMembers.size === 0) return 'Pending';
  const allCompleted = Array.from(assignedMembers).every((member) => completedValues.has(member));
  return allCompleted ? 'Completed' : 'Pending';
};

const matchesCurrentStaff = (task, currentUserRecord, teamsData = {}) => {
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

  const matchesAssignedTeam = teamAssignmentValues.some((value) => userTeams.has(normalizeTaskValue(value)));
  if (matchesAssignedTeam) return true;

  const currentEmail = normalizeTaskValue(currentUser?.email || currentUserRecord?.email);
  const taskEmail = normalizeTaskValue(task.assignedEmail || task.email || task.staffEmail || task.userEmail);
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
  ].map(normalizeTaskValue);

  if (taskValues.some((value) => currentValues.has(value) && value)) {
    return true;
  }

  return false;
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

const Dashboard = () => {
  const [tasksCount, setTasksCount] = useState({ completed: 0, pending: 0 });
  const [tasks, setTasks] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [currentUserRecord, setCurrentUserRecord] = useState(null);
  const [teamsData, setTeamsData] = useState({});
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [weather, setWeather] = useState(null);
  const [weatherMessage, setWeatherMessage] = useState('Loading location settings...');

  const upcomingTasks = (tasks || [])
    .filter((task) => getTaskStatus(task, currentUserRecord, teamsData) !== 'Completed')
    .sort((a, b) => {
      const dateA = new Date(getTaskDateValue(a) || 0).getTime();
      const dateB = new Date(getTaskDateValue(b) || 0).getTime();
      return dateA - dateB;
    })
    .slice(0, 3);

  useEffect(() => {
    const currentUser = auth?.currentUser;
    if (!currentUser) {
      setCurrentUserRecord(null);
      setTeamsData({});
      return;
    }

    let mounted = true;
    const loadUserRecord = async () => {
      try {
        const { get, ref } = await import('firebase/database');
        const [usersSnap, teamsSnap] = await Promise.all([
          get(ref(db, 'users')),
          get(ref(db, 'teams')),
        ]);
        const users = usersSnap.val() || {};
        const teams = teamsSnap.val() || {};
        if (!mounted) return;

        setTeamsData(teams);

        const emailLower = (currentUser.email || '').toLowerCase();
        const match = Object.entries(users).find(([id, value]) => {
          if (!value || typeof value !== 'object') return false;
          return (value.email || '').toLowerCase() === emailLower
            || id === currentUser.uid
            || value.uid === currentUser.uid;
        });

        if (match && mounted) {
          const [id, record] = match;
          setCurrentUserRecord({ id, ...record });
          return;
        }

        setCurrentUserRecord({ id: currentUser.uid, uid: currentUser.uid, email: currentUser.email });
      } catch (e) {
        console.warn('Failed to load current user record', e?.message || e);
      }
    };

    loadUserRecord();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let unsubscribe;
    let tasksUnsub;
    let reportsUnsub;
    try {
      const { ref, onValue } = require('firebase/database');
      const binsRef = ref(db, 'bins');
      unsubscribe = onValue(binsRef, (snapshot) => {
        const data = snapshot.val();
        const list = data
          ? Object.entries(data).map(([key, value]) => ({ id: key, ...(value || {}) }))
          : [];
        const binAlerts = [];
        list.forEach((b) => {
          const status = (b.status || '').toString().toLowerCase();
          const fill = b.fillLevel ?? b.fillPercentage ?? b.fill ?? null;
          if (status.includes('critical') || (typeof fill === 'number' && fill >= 95)) {
            binAlerts.push({ id: b.id, type: 'Critical', message: `${b.id} is critical`, ts: b.updatedAt || b.lastReported || null });
          } else if (status.includes('full') || (typeof fill === 'number' && fill >= 100)) {
            binAlerts.push({ id: b.id, type: 'Full', message: `${b.id} is full`, ts: b.updatedAt || b.lastReported || null });
          } else if (status.includes('nearly') || (typeof fill === 'number' && fill >= 80)) {
            binAlerts.push({ id: b.id, type: 'Nearly Full', message: `${b.id} is nearly full`, ts: b.updatedAt || b.lastReported || null });
          }
        });

        setAlerts((prev) => {
          const reportOnly = (prev || []).filter((a) => a.source === 'report');
          return [...binAlerts, ...reportOnly].slice(0, 10);
        });
      });

      try {
        const { ref: refTasks, onValue: onValueTasks } = require('firebase/database');
        const tasksRef = refTasks(db, 'tasks');
        tasksUnsub = onValueTasks(tasksRef, (snap) => {
          const t = snap.val();
          const items = t ? Object.entries(t).map(([k, v]) => ({ id: k, ...(v || {}) })) : [];
          const filteredItems = currentUserRecord
            ? items.filter((it) => matchesCurrentStaff(it, currentUserRecord, teamsData))
            : [];

          setTasks(filteredItems);

          let completed = 0, pending = 0;
          filteredItems.forEach((it) => {
            const status = getTaskStatus(it, currentUserRecord, teamsData);
            if (status === 'Completed') completed += 1;
            else pending += 1;
          });
          setTasksCount({ completed, pending });
        });
      } catch (e) {
        console.warn('Tasks subscription failed', e?.message || e);
      }

      try {
        const { ref: refRep, onValue: onValueRep } = require('firebase/database');
        const reportsRef = refRep(db, 'reports');
        reportsUnsub = onValueRep(reportsRef, (snap) => {
          const r = snap.val();
          const list = r ? Object.entries(r).map(([k, v]) => ({ id: k, ...(v || {}), source: 'report' })) : [];
          const repAlerts = list.slice(-10).reverse().map((rep) => ({ id: rep.id, type: rep.issueType || 'Report', message: `${rep.issueType || 'Report'} at ${rep.location || 'unknown'}`, ts: rep.createdAt || null, source: 'report' }));
          setAlerts((prev) => {
            const derived = (prev || []).filter((a) => a.source !== 'report');
            return [...derived, ...repAlerts].slice(0, 10);
          });
        });
      } catch (e) {
        // ignore
      }
    } catch (e) {
      console.warn('Realtime bins subscription not available', e.message || e);
    }

    return () => {
      try { if (typeof unsubscribe === 'function') unsubscribe(); } catch (e) {}
      try { if (typeof tasksUnsub === 'function') tasksUnsub(); } catch (e) {}
      try { if (typeof reportsUnsub === 'function') reportsUnsub(); } catch (e) {}
    };
  }, [currentUserRecord, teamsData]);

  useEffect(() => {
    let active = true;
    if (!currentUserRecord) {
      setWeatherMessage('Loading location settings...');
      return () => { active = false; };
    }

    if (!currentUserRecord?.allowLocation) {
      setWeather(null);
      setWeatherMessage('Enable location in Profile for local weather');
      return () => { active = false; };
    }

    const loadLocalWeather = async () => {
      try {
        setWeatherMessage('Getting current location...');
        if (Platform.OS === 'android') {
          const [hasFinePermission, hasCoarsePermission] = await Promise.all([
            PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION),
            PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION),
          ]);
          if (!hasFinePermission && !hasCoarsePermission) {
            if (active) setWeatherMessage('Allow location permission to see local weather');
            return;
          }
        } else {
          const authorization = await Geolocation.requestAuthorization('whenInUse');
          if (authorization !== 'granted') {
            if (active) setWeatherMessage('Allow location permission to see local weather');
            return;
          }
        }

        const position = await new Promise((resolve, reject) => {
          Geolocation.getCurrentPosition(resolve, reject, {
            accuracy: { android: 'high', ios: 'best' },
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 300000,
            showLocationDialog: true,
            forceLocationManager: Platform.OS === 'android',
          });
        });
        const { latitude, longitude } = position.coords;
        if (active) setWeatherMessage('Loading local weather...');
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&temperature_unit=celsius&wind_speed_unit=kmh`,
        );
        if (!response.ok) throw new Error('Weather service is unavailable');
        const data = await response.json();
        if (!data.current) throw new Error('Current weather is unavailable');
        const description = getWeatherDescription(data.current.weather_code);
        if (active) {
          setWeather({
            ...description,
            temperature: Math.round(data.current.temperature_2m),
            humidity: Math.round(data.current.relative_humidity_2m),
            feelsLike: Math.round(data.current.apparent_temperature),
            windSpeed: Math.round(data.current.wind_speed_10m),
          });
          setWeatherMessage('');
        }
      } catch (error) {
        console.warn('Failed to load local weather', error?.message || error);
        if (active) {
          setWeather(null);
          setWeatherMessage('Local weather unavailable');
        }
      }
    };

    loadLocalWeather();
    return () => { active = false; };
  }, [currentUserRecord]);

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* --- WELCOME SECTION --- */}
        <View style={styles.welcomeSection}>
          <Text style={styles.welcomeText}>Good Morning, James! 👋</Text>
          <Text style={styles.welcomeSubtext}>Stay safe and keep the city clean.</Text>
        </View>

        {/* --- WEATHER CARD --- */}
        <View style={styles.weatherCard}>
          <View style={styles.weatherLeft}>
            <View style={styles.weatherIconContainer}>
              <Text style={{ fontSize: 40 }}>{weather?.icon || '🌡️'}</Text>
            </View>
            <View style={styles.tempContainer}>
              <Text style={styles.temperature}>{weather ? `${weather.temperature}°` : '—'}<Text style={styles.tempUnit}>C</Text></Text>
              <Text style={styles.weatherCondition} numberOfLines={2}>{weather?.condition || weatherMessage}</Text>
            </View>
          </View>
          <View style={styles.weatherRight}>
            <Text style={styles.weatherDetail}>Humidity: <Text style={styles.weatherDetailVal}>{weather ? `${weather.humidity}%` : '—'}</Text></Text>
            <Text style={styles.weatherDetail}>Wind: <Text style={styles.weatherDetailVal}>{weather ? `${weather.windSpeed} km/h` : '—'}</Text></Text>
            <Text style={styles.weatherDetail}>Feels like: <Text style={styles.weatherDetailVal}>{weather ? `${weather.feelsLike}°C` : '—'}</Text></Text>
          </View>
        </View>

        <View style={styles.taskListCard}>
          <View style={styles.sectionHeaderNoPadding}>
            <Text style={styles.sectionTitle}>Task List</Text>
            <Text style={styles.dateText}>{tasks.length} active</Text>
          </View>

          {upcomingTasks.length === 0 ? (
            <Text style={styles.emptyTaskText}>No pending tasks available.</Text>
          ) : (
            upcomingTasks.map((task, index) => (
              <View key={task.id || index} style={styles.taskListItem}>
                <View style={styles.taskListDot} />
                <View style={styles.taskListContent}>
                  <Text style={styles.taskListTitle}>{task.title || task.name || task.binId || task.bin || 'Task'}</Text>
                  <Text style={styles.taskListMeta}>{task.location || task.address || task.site || 'No location'} • {formatTaskTime(task)}</Text>
                  <Text style={styles.taskListStatus}>{getTaskStatus(task, currentUserRecord, teamsData)}</Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* --- TASK STATUS SECTION --- */}
        <View style={styles.taskContainer}>
           <View style={[styles.taskCard, styles.completedCard]}>
              <View style={styles.taskIconWrapper}>
                 <ClipboardCheckIcon size={48} />
              </View>
              <View>
                <Text style={styles.taskLabel}>Completed</Text>
                <Text style={styles.taskCount}>{tasksCount.completed}</Text>
                <Text style={styles.taskSub}>Tasks</Text>
              </View>
           </View>

           <View style={[styles.taskCard, styles.pendingCard]}>
              <View style={styles.taskIconWrapper}>
                 <OrangeCleaningIcon size={48} />
              </View>
              <View>
                <Text style={styles.taskLabel}>Pending</Text>
                 <Text style={styles.taskCount}>{tasksCount.pending}</Text>
                <Text style={styles.taskSub}>Tasks</Text>
              </View>
           </View>
        </View>

        {/* --- RECENT ALERTS --- */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent Alerts</Text>
          <TouchableOpacity
            accessibilityRole="button"
            onPress={() => setShowAllAlerts((current) => !current)}
          >
            <Text style={styles.viewAllText}>{showAllAlerts ? 'Show Less' : 'View All'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.alertsList}>
          {alerts.length === 0 ? (
            <Text style={{ paddingHorizontal: 20, color: '#717171' }}>No recent alerts</Text>
          ) : (
            (showAllAlerts ? alerts : alerts.slice(0, 3)).map((a) => (
              <View key={a.id + (a.ts||'')} style={styles.alertItem}>
                <View style={[styles.alertDot, { backgroundColor: a.type === 'Critical' ? '#ef4444' : a.type === 'Full' ? '#f43f5e' : a.type === 'Nearly Full' ? '#f59e0b' : '#3b82f6' }]} />
                <Text style={styles.alertText}>{a.message}</Text>
                <Text style={styles.alertTime}>{a.ts ? new Date(a.ts).toLocaleTimeString() : ''}</Text>
              </View>
            ))
          )}
        </View>

      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fcfcfc' },
  scrollContent: { paddingBottom: 100 },
  welcomeSection: {
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 15,
  },
  welcomeText: { fontSize: 22, fontWeight: 'bold', color: '#1c1c1c' },
  welcomeSubtext: { fontSize: 14, color: '#717171', marginTop: 4 },
  weatherCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#f0f0f0',
  },
  weatherLeft: { flexDirection: 'row', alignItems: 'center' },
  weatherIconContainer: { position: 'relative', marginRight: 15 },
  tempContainer: { justifyContent: 'center' },
  temperature: { fontSize: 34, fontWeight: 'bold', color: '#1c1c1c' },
  tempUnit: { fontSize: 20, color: '#717171' },
  weatherCondition: { fontSize: 14, color: '#717171', fontWeight: '500' },
  weatherRight: { justifyContent: 'center' },
  weatherDetail: { fontSize: 12, color: '#717171', marginBottom: 2 },
  weatherDetailVal: { fontWeight: 'bold', color: '#4a4a4a' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 25,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1c1c1c' },
  dateText: { fontSize: 13, color: '#717171' },
  taskContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginTop: 20,
    justifyContent: 'space-between',
  },
  taskCard: {
    width: '48%',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  completedCard: { backgroundColor: '#f0fdf4', borderColor: '#dcfce7' },
  pendingCard: { backgroundColor: '#fffbeb', borderColor: '#fef3c7' },
  taskIconWrapper: { marginRight: 12 },
  taskLabel: { fontSize: 12, color: '#4a4a4a', fontWeight: '600' },
  taskCount: { fontSize: 22, fontWeight: 'bold', color: '#1c1c1c' },
  taskSub: { fontSize: 10, color: '#717171' },
  viewAllText: { fontSize: 14, color: PRIMARY_GREEN, fontWeight: 'bold' },
  taskListCard: {
    backgroundColor: '#ffffff',
    marginHorizontal: 20,
    marginTop: 18,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f0f0f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeaderNoPadding: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  taskListItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
  },
  taskListDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: PRIMARY_GREEN,
    marginTop: 7,
    marginRight: 12,
  },
  taskListContent: {
    flex: 1,
  },
  taskListTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1c1c1c',
  },
  taskListMeta: {
    fontSize: 12,
    color: '#717171',
    marginTop: 3,
  },
  taskListStatus: {
    marginTop: 5,
    color: PRIMARY_GREEN,
    fontSize: 11,
    fontWeight: '700',
  },
  emptyTaskText: {
    color: '#717171',
    fontSize: 13,
    paddingVertical: 8,
  },
  alertsList: { paddingHorizontal: 20, marginTop: 5 },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  alertDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  alertText: { flex: 1, fontSize: 15, color: '#1c1c1c', fontWeight: '500' },
  alertTime: { fontSize: 12, color: '#717171' },
});

export default Dashboard;
