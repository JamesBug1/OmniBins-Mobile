# OmniBins Cloud Functions

This folder contains a Firebase Realtime Database trigger that notifies team members via FCM when a task is created or updated.

Setup

1. Install dependencies:

```bash
cd functions
npm install
```

2. Ensure you have the Firebase CLI installed and are logged in:

```bash
npm install -g firebase-tools
firebase login
```

3. Initialize or confirm the Firebase project is set. If you haven't initialized Functions in this repo, run:

```bash
firebase init functions
```

4. Deploy the function:

```bash
firebase deploy --only functions:notifyTeamOnTaskAssign --project omnibins
```

Testing

- To test quickly, sign in on a device and confirm the `users/{uid}/fcmToken` is set.
- Create a task in the Realtime Database under `/tasks/` with `assignedToTeam` (or `team`) set to the team name. The function will pick it up and send notifications.

Notes

- The function reads the `/users` node and looks for `team`, `teamName`, `teams`, or `groups` fields to match team membership. Adjust as needed for your schema.
- It sends notifications via `sendMulticast` in chunks of 500 tokens.
