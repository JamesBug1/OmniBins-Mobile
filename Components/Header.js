import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, ScrollView } from 'react-native';
import { get, onValue, ref, update } from 'firebase/database';
import { NotificationIcon } from './Icons';
import { auth, db, getUserRecordIdForCurrentUser } from '../firebaseConfig';

const PRIMARY_GREEN = '#00a63e';

const formatTaskType = value => String(value || '')
  .trim()
  .replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, character => character.toUpperCase());

const Header = ({ title }) => {
  const [inboxVisible, setInboxVisible] = useState(false);
  const [userRecordId, setUserRecordId] = useState(null);
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    let active = true;
    getUserRecordIdForCurrentUser().then(id => {
      if (active) setUserRecordId(id);
    }).catch(error => console.warn('Could not resolve notification inbox', error?.message || error));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!userRecordId) return undefined;
    return onValue(ref(db, `users/${userRecordId}/notifications`), async snapshot => {
      const values = snapshot.val() || {};
      const rawItems = Object.entries(values)
        .map(([id, notification]) => ({ id, ...notification }))
        .sort((first, second) => Number(second.createdAt || 0) - Number(first.createdAt || 0));
      const items = await Promise.all(rawItems.map(async notification => {
        if (notification.taskType || !notification.taskId) return notification;
        try {
          const taskSnapshot = await get(ref(db, `tasks/${notification.taskId}`));
          const task = taskSnapshot.val();
          if (!task) return notification;
          const taskType = formatTaskType(task.type || task.taskType || task.category || task.taskCategory || task.task_type || task.serviceType);
          const taskTitle = task.title || task.name || task.binId || task.bin;
          return {
            ...notification,
            taskType,
            title: taskType ? `${taskType} task assigned` : notification.title,
            body: task.description || task.body || taskTitle || notification.body,
          };
        } catch (error) {
          console.warn('Could not load task notification details', error?.message || error);
          return notification;
        }
      }));
      setNotifications(items);
    }, error => console.warn('Could not load notifications', error?.message || error));
  }, [userRecordId]);

  const unreadCount = notifications.filter(notification => !notification.read).length;

  const markNotificationRead = async notificationId => {
    if (!userRecordId) return;
    try {
      await update(ref(db, `users/${userRecordId}/notifications/${notificationId}`), { read: true });
    } catch (error) {
      Alert.alert('Could not update notification', error?.message || 'Please try again.');
    }
  };

  const markAllRead = async () => {
    if (!userRecordId) return;
    try {
      await Promise.all(notifications
        .filter(notification => !notification.read)
        .map(notification => update(ref(db, `users/${userRecordId}/notifications/${notification.id}`), { read: true })));
    } catch (error) {
      Alert.alert('Could not update notifications', error?.message || 'Please try again.');
    }
  };

  return (
    <View style={styles.header}>
      {/* Invisible spacer to keep the title centered now that menu is removed */}
      <View style={styles.spacer} />

      <Text style={styles.headerTitle}>{title}</Text>

      <TouchableOpacity
        style={styles.iconButton}
        onPress={() => {
          if (!auth?.currentUser) {
            Alert.alert('Not signed in', 'Sign in to view your notifications.');
            return;
          }
          setInboxVisible(true);
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Notifications, ${unreadCount} unread`}
      >
        <NotificationIcon size={32} color="#ffffff" badgeCount={unreadCount} />
      </TouchableOpacity>

      <Modal visible={inboxVisible} transparent animationType="fade" onRequestClose={() => setInboxVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.inbox}>
            <View style={styles.inboxHeader}>
              <Text style={styles.inboxTitle}>Notifications</Text>
              <TouchableOpacity onPress={() => setInboxVisible(false)} accessibilityRole="button" accessibilityLabel="Close notifications">
                <Text style={styles.closeButton}>Close</Text>
              </TouchableOpacity>
            </View>

            {unreadCount > 0 && (
              <TouchableOpacity style={styles.markReadButton} onPress={markAllRead} accessibilityRole="button">
                <Text style={styles.markReadText}>Mark all as read</Text>
              </TouchableOpacity>
            )}

            <ScrollView style={styles.notificationList} contentContainerStyle={notifications.length ? undefined : styles.emptyList}>
              {notifications.length === 0 ? (
                <Text style={styles.emptyText}>No notifications yet</Text>
              ) : notifications.map(notification => (
                <TouchableOpacity
                  key={notification.id}
                  style={[styles.notificationItem, !notification.read && styles.unreadItem]}
                  onPress={() => markNotificationRead(notification.id)}
                  activeOpacity={0.75}
                >
                  <View style={styles.notificationCopy}>
                    <Text style={styles.notificationTitle}>
                      {notification.taskType ? `${formatTaskType(notification.taskType)} task assigned` : notification.title || 'OmniBins update'}
                    </Text>
                    <Text style={styles.notificationBody}>{notification.body || 'You have a new update.'}</Text>
                    <Text style={styles.notificationDate}>
                      {notification.createdAt ? new Date(notification.createdAt).toLocaleString() : 'Just now'}
                    </Text>
                  </View>
                  {!notification.read && <View style={styles.unreadDot} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  header: {
    backgroundColor: PRIMARY_GREEN,
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 15,
    zIndex: 100,


  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
    flex: 1,
  },
  iconButton: {
    padding: 5,
    width: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spacer: {
    width: 50,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  inbox: {
    maxHeight: '78%',
    backgroundColor: '#ffffff',
    borderRadius: 10,
    overflow: 'hidden',
  },
  inboxHeader: {
    minHeight: 58,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#d1d5db',
  },
  inboxTitle: {
    color: '#111827',
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    color: PRIMARY_GREEN,
    fontSize: 15,
    fontWeight: '600',
  },
  markReadButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  markReadText: {
    color: PRIMARY_GREEN,
    fontSize: 13,
    fontWeight: '600',
  },
  notificationList: {
    flexGrow: 0,
  },
  emptyList: {
    minHeight: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 15,
  },
  notificationItem: {
    minHeight: 88,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e5e7eb',
  },
  unreadItem: {
    backgroundColor: '#f0fdf4',
  },
  notificationCopy: {
    flex: 1,
    gap: 4,
  },
  notificationTitle: {
    color: '#111827',
    fontSize: 15,
    fontWeight: '700',
  },
  notificationBody: {
    color: '#4b5563',
    fontSize: 14,
    lineHeight: 20,
  },
  notificationDate: {
    color: '#6b7280',
    fontSize: 12,
  },
  unreadDot: {
    width: 9,
    height: 9,
    marginLeft: 12,
    borderRadius: 5,
    backgroundColor: PRIMARY_GREEN,
  },
});

export default Header;
