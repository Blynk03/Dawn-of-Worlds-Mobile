# Notifications (DOW-16, DOW-28)

Players get a push notification when:

- **it's their turn** (with their current power),
- **a new round starts** (everyone else, with their place in the turn order),
- **a friend joins** their world (the host),
- **someone nudges them** (any player, once every 12 hours per world), and
- **their turn has waited too long** (default 24 hours; the host can pick off/6/12/24/48 in
  _World settings_).

Each player can mute a world in _World settings_. Notifications go to the **Android app**.
iPhone/iPad needs the Apple developer account (DOW-77); web players see the "new" badges instead.

## How it works

1. After sign-in, the app asks for permission and registers this device's **Expo push token**
   (`register_push_token`). Signing out removes it.
2. Database triggers (`supabase/migrations/20261113000000_notifications.sql`) write each
   notification to `push_outbox` and post it to Expo's push service with **pg_net**.
3. Expo delivers it through **Firebase Cloud Messaging** to the phone.
4. A **pg_cron** job runs `send_turn_reminders()` every 15 minutes.
5. Tapping a notification opens that world.

## One-time setup

1. **Expo project:** `dawn-of-worlds` on expo.dev. Its Project ID is in `app.json` →
   `expo.extra.eas.projectId`.
2. **Firebase:** a project with an Android app for package `com.blynk03.dawnofworlds`. The
   contents of its `google-services.json` are the GitHub Actions secret **`GOOGLE_SERVICES_JSON`**;
   builds write the file into the app. (It is not committed; the repo is public.)
3. **Expo access token:** expo.dev → Account settings → Access tokens → create one, and save it
   as the GitHub Actions secret **`EXPO_TOKEN`**.
4. **Android signing key:** run the **Set up Android signing (EAS)** workflow once (Actions tab →
   Run workflow). Expo creates and keeps the app's keystore and starts the first cloud build.
   This is needed because expo.dev won't take the next step without a keystore, and Expo only
   generates one when someone confirms it.
5. **Expo ↔ Firebase:** in Firebase → Project settings → Service accounts, generate a private
   key. On expo.dev → project → Credentials, open the Android application identifier
   (`com.blynk03.dawnofworlds`) and upload it as the **FCM V1 service account key**. This key is
   secret: don't commit or share it, and delete the downloaded file afterwards.
6. **Supabase:** run the notifications migration. It enables the `pg_net` and `pg_cron`
   extensions.

## Troubleshooting

In the Supabase SQL Editor:

```sql
-- Recent notifications: who, what, and whether they were sent to a device.
select created_at, kind, title, devices, sent_at, request_id
from push_outbox order by id desc limit 20;

-- Expo's answer for a sent notification (use request_id from above).
select status_code, content::text from net._http_response where id = <request_id>;

-- Registered devices.
select user_id, platform, updated_at from push_tokens;

-- The reminder job.
select * from cron.job where jobname = 'dow-turn-reminders';
```

- `devices = 0`: that player has no device registered (not signed in on the Android app, or
  notifications denied). _World settings_ shows this device's status.
- A response mentioning **InvalidCredentials** means step 3 (the FCM key on expo.dev) is missing.
