# Supabase setup

The app uses the Supabase project **`ypbvbyijrpiqwfymqnpb`** for sign-in and data. These are the one-time steps in the [Supabase dashboard](https://supabase.com/dashboard/project/ypbvbyijrpiqwfymqnpb).

## 1. Create the tables

Paste the **contents** of the migration file, not its file name. Pick one of these:

- **Dashboard:** open **SQL Editor → New query**, paste the contents of `supabase/migrations/20261102000000_profiles_worlds.sql`, then click **Run**.
- **CLI:** `npx supabase login`, then `npx supabase link --project-ref ypbvbyijrpiqwfymqnpb`, then `npx supabase db push`.

This creates `profiles`, `worlds` and `world_members`, with row-level security on all of them. Signed-in users can see only worlds they belong to and the profiles of people they share a world with.

Run each new file in `supabase/migrations/` once, in filename order.

## 2. Allow the app's sign-in redirects

Go to **Authentication → URL Configuration**:

- **Site URL:** `dawnofworlds://`
- **Redirect URLs:** add all four of these:
  - `dawnofworlds://**`: the installed app (development and store builds)
  - `exp://**`: Expo Go during development
  - `http://localhost:8081/**`: the web version during development
  - `https://blynk03.github.io/Dawn-of-Worlds-Mobile/**`: the published web app (see [install.md](install.md))

Without these, the email link opens Supabase's site instead of the app.

## 3. Send email through your own SMTP (needed for friends to get emails)

Supabase's built-in email is for testing only. It sends a couple of emails an hour, may only deliver to members of your Supabase organization, and on newer free projects it locks the email templates. Custom SMTP works on the free plan and fixes all three.

**No domain (what this project uses): Gmail**

1. Create a dedicated Gmail account for the app, so no personal inbox is involved.
2. On that account, turn on 2-Step Verification, then create an **app password** at myaccount.google.com (search "App passwords").
3. In Supabase, go to **Authentication → Emails → SMTP Settings** and turn on **Enable Custom SMTP**:
   - Host `smtp.gmail.com`, port `587` (465 also works)
   - Username and sender email: the full Gmail address
   - Password: the app password
   - Sender name: `Dawn of Worlds`

Gmail allows a few hundred emails a day, which is plenty for a group of friends. The first emails may land in spam, so ask friends to mark one "Not spam".

**With a domain later:** a transactional provider like Resend (free plan) is more reliable. It needs DNS records on a domain you own.

Supabase also has its own hourly email limit. Raise it if needed under **Authentication → Rate Limits**.

## 4. Put the code in the sign-in email

The sign-in screen accepts either the link or the code from the email (6–10 digits; this project sends 8). The code is handy when the email is open on a different device. Templates can only be edited once custom SMTP (step 3) is on.

Go to **Authentication → Emails → Templates → Magic Link** and set the body to something like:

```html
<h2>Sign in to Dawn of Worlds</h2>
<p><a href="{{ .ConfirmationURL }}">Tap here to sign in</a></p>
<p>Or enter this code in the app: <strong>{{ .Token }}</strong></p>
```

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
