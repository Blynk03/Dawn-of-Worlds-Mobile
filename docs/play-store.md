# Google Play (DOW-17)

The Android app is published to Google Play under `com.blynk03.dawnofworlds`.

## Pages Google asks for

- Privacy policy: <https://blynk03.github.io/Dawn-of-Worlds-Mobile/privacy.html>
- Delete account (Data safety form): <https://blynk03.github.io/Dawn-of-Worlds-Mobile/delete-account.html>

Both are static files in `public/`, published with the web app by `deploy-web.yml`.

## Releasing a build

1. One time: upload a Google service account key with access to the app to expo.dev
   (Credentials → Android → `com.blynk03.dawnofworlds` → Google Service Account Key). The key is
   a secret: it lives only on expo.dev.
2. GitHub → Actions → **Release to Google Play** → Run workflow → choose **internal** (our group,
   no review) or **closed** (the closed test Google requires before production).
3. The build is uploaded as a **draft** release. In Play Console → Testing → that track, review the
   draft and roll it out. (Google only accepts drafts from the API until the app has been
   published once; after that, `releaseStatus` in `eas.json` can be changed to `completed`.)

New personal developer accounts must run a closed test with at least 12 testers opted in for 14
days in a row before applying for production access.

## App access (sign-in details for Google's reviewers)

The app signs in with an emailed link or code, which reviewers can't receive. Instead:

1. Supabase → Authentication → Users → Add user → Create new user: an email such as
   `play-review@…` (it needn't be a real inbox), a strong password, **Auto Confirm User** ticked.
2. Play Console → App content → App access → "All or some functionality is restricted" → add
   instructions:
   - Username: the email above. Password: the password above.
   - Instructions: "On the sign-in screen, tap **Sign in with a password**, then enter the email
     and password. Create a world, or open the existing one, to see the game."

The password lives only in Supabase and Play Console.

## Data safety answers

- Does the app collect or share any of the required user data types? **Yes**
- Is all user data encrypted in transit? **Yes** (Supabase, Expo and FCM all use HTTPS/TLS)
- Which account creation methods? **Username and other authentication** (email + emailed code)
- Delete account URL: the page above. Can users request that some data be deleted without deleting
  their account? **No** (they can delete their own comments in the app).
- Data shared with third parties: **None** (Supabase, Expo and Google push are service providers
  processing data on our behalf, which Google doesn't count as sharing).

| Category → type                             | Collected | Required?                                    | Purposes                                                        |
| ------------------------------------------- | --------- | -------------------------------------------- | --------------------------------------------------------------- |
| Personal info → Email address               | Yes       | Required                                     | App functionality, Account management                           |
| Personal info → Name                        | Yes       | Required                                     | App functionality (the name you play under, your gods' names)   |
| App activity → Other user-generated content | Yes       | Required                                     | App functionality (worlds, actions, comments, reactions, votes) |
| Device or other IDs                         | Yes       | Optional (only if notifications are allowed) | App functionality (push token)                                  |

Not collected: location, financial info, health, messages, photos/videos, audio, files, calendar,
contacts, app interactions/analytics, web browsing, crash logs, diagnostics.
