# OmniBins Admin Sender

This is a small Node process you can run on any machine to send FCM notifications when tasks are assigned or a bin reports full/high-gas readings. It listens to Realtime Database task, collection, sensor, and `/alerts` data.

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
# Optional: raw MQ-4/MQ-135 trigger threshold and maximum sensor reading age
export GAS_ALERT_THRESHOLD="1000"
export GAS_ALERT_MAX_AGE_MS="900000"
npm start
```

Behavior

- On startup the script reads existing `/tasks` into a cache.
- It listens for `child_added` (new tasks) and `child_changed` (team changed) events.
- When a task is created or assigned/reassigned, it queries `/users` for members of the task's team and sends FCM notifications to their `fcmToken` fields.
- A `full`/100% bin reading alerts the assigned active collection user(s).
- On a full-bin transition or a high-gas alert, the sender creates or promotes one date-specific pending collection task in `/tasks` and `/collections`, copying the assigned collector from the active collection schedule. The all-user alert inbox/push includes that task ID and date; the assigned collector can finish that occurrence from Schedule.
- An MQ-4 or MQ-135 reading at or above `GAS_ALERT_THRESHOLD` creates an inbox alert for every user and sends a push to users who opted in and have an FCM token.
- A new `/alerts/{alertId}` record with `type: "sensor_high_gas"` is added to every user's inbox and pushed to all opted-in devices. The latest existing high-gas system alert is delivered once when the sender starts; older high-gas alert history is not replayed.
- Daily/weekly recurrence records are assignment templates only; they do not create Finish buttons by themselves. A capacity-triggered collection task is created for the alert date and can be finished independently.
- Gas readings older than `GAS_ALERT_MAX_AGE_MS` are ignored. Both gas values are raw sensor units, not calibrated ppm; set the threshold to match the sensor calibration before relying on it for safety decisions.
- Capacity and gas alerts are deduplicated until a fresh sensor reading clears the condition.

Notes

- Keep this process running (systemd, pm2, Docker, etc.) for continuous delivery.
- This avoids requiring Firebase Blaze billing for Cloud Functions.
