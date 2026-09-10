# OmniBins Admin Sender

This is a small Node process you can run on any machine to send FCM notifications when tasks are assigned. It listens to Realtime Database `/tasks` changes and notifies team members.

Prerequisites

- A service account JSON key for your Firebase project, or Application Default Credentials available on the host.
- Node 18+ (or compatible)

Installation

```bash
cd admin-sender
npm install
```

Run

Set either `GOOGLE_APPLICATION_CREDENTIALS` or `SERVICE_ACCOUNT_PATH` to point to your service account JSON file. Optionally set `FIREBASE_DATABASE_URL` if your DB URL differs.

```bash
export SERVICE_ACCOUNT_PATH="/path/to/serviceAccount.json"
export FIREBASE_DATABASE_URL="https://omnibins-default-rtdb.firebaseio.com"
npm start
```

Behavior

- On startup the script reads existing `/tasks` into a cache.
- It listens for `child_added` (new tasks) and `child_changed` (team changed) events.
- When a task is created or assigned/reassigned, it queries `/users` for members of the task's team and sends FCM notifications to their `fcmToken` fields.

Notes

- Keep this process running (systemd, pm2, Docker, etc.) for continuous delivery.
- This avoids requiring Firebase Blaze billing for Cloud Functions.
