# Supabase setup

The app uses the Supabase project **`ypbvbyijrpiqwfymqnpb`** for sign-in and data. These are the one-time steps in the [Supabase dashboard](https://supabase.com/dashboard/project/ypbvbyijrpiqwfymqnpb).

## 1. Create the tables

Pick one of these:

- **Dashboard:** open **SQL Editor → New query**, paste the contents of `supabase/migrations/20261102000000_profiles_worlds.sql`, then click **Run**.
- **CLI:** `npx supabase login`, then `npx supabase link --project-ref ypbvbyijrpiqwfymqnpb`, then `npx supabase db push`.

This creates `profiles`, `worlds` and `world_members`, with row-level security on all of them. Signed-in users can see only worlds they belong to and the profiles of people they share a world with.

Run each new file in `supabase/migrations/` once, in filename order.

## 2. Allow the app's sign-in redirects

Go to **Authentication → URL Configuration**:

- **Site URL:** `dawnofworlds://`
- **Redirect URLs:** add all three of these:
  - `dawnofworlds://**`: the installed app (development and store builds)
  - `exp://**`: Expo Go during development
  - `http://localhost:8081/**`: the web version during development

Without these, the email link opens Supabase's site instead of the app.

## 3. Put the code in the sign-in email

The sign-in screen accepts either the link or a 6-digit code. Typing the code is handy when the email is on a different device from the one you're signing in on. Supabase only sends the code if the email template includes it.

Go to **Authentication → Emails → Templates → Magic Link** and add a line like:

```html
<p>Or enter this code in the app: <strong>{{ .Token }}</strong></p>
```

## 4. Make sure emails reach your friends

Supabase's built-in email service is meant for testing. It has a low hourly limit and may only deliver to members of your Supabase organization. For a group of friends, set up a custom SMTP provider (for example Resend, Postmark or SendGrid) under **Project Settings → Authentication → SMTP Settings**. The alternative is to invite each friend to the Supabase organization. Check the dashboard for the current limits.

## 5. Local development

```bash
cp .env.example .env.local   # then fill in the URL and publishable key
npm start
```

Only the **publishable** key (`sb_publishable_…`) goes in the app. Never put the **secret** / `service_role` key in the app, `.env.local`, or a chat message. The app refuses to start if it sees one.

## Later

- **Sign in with Apple / Google** need an Apple Developer account and a Google Cloud OAuth client. Enable them under **Authentication → Sign In / Providers**. The guides are [Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple?platform=react-native) and [Google](https://supabase.com/docs/guides/auth/social-login/auth-google?platform=react-native).
- **App store builds (DOW-17):** add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as EAS environment variables.

## Testing the database rules locally

`scripts/test-db.sh` applies the migrations to a throwaway database on a local Postgres and checks every access rule (who can read and change which rows). CI runs it on every PR.
