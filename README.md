# NFL Pick'Em

A web app for weekly NFL picks. Netlify publishes the `phone-app` folder (see `netlify.toml`).
Logins and picks are stored in Firebase. Files outside `phone-app` never go on the website.

## How access works

- **Logins:** usernames become Firebase accounts named `<username>@pickem.app`.
- **Databases:** a login only sees a database (league) when it's tagged with
  `access/<username>/leagues/<league> = true`. A login with no tag sees nothing.
- **Players:** a name on a league's list belongs to the login with the same name (capitals
  don't matter). Each person can only make picks for their own name, and the database rules
  enforce this.
- **Administrator:** the `dakota` login gets an **Admin** tab: add and remove names, create new
  logins, remove a login's access to a database, and set players' email addresses. To change the
  administrator, edit `ADMIN` in `phone-app/index.html` and `netlify/functions/lib/pickem.mjs`,
  and the `dakota@pickem.app` entries in `database.rules.json`.

## Server settings

The app reads the Firebase database URL and Web API key from the Netlify environment variables
`PICKEM_DB_URL` and `PICKEM_API_KEY` (through `/api/config`), so the login screen only asks for a
username and password. `phone-app/config.js` can still hold them instead.

## Database rules

`database.rules.json` must be pasted into Firebase by hand: **Build > Realtime Database > Rules**,
replace everything, then **Publish**. Firebase does not read the copy in this repo.

## Things to know

- Creating logins on the Admin tab goes through the server (it needs `FIREBASE_SERVICE_ACCOUNT`).
  With that set up, switch off Firebase's public sign-up so nobody else can make accounts:
  Authentication > Settings > User actions > untick **Enable create (sign-up)**.
- The app stops picks at kickoff. The database rules don't check kickoff times, so a technical
  user could still change their own pick after a game starts.

## Reminder emails (one-time setup)

A scheduled Netlify function (`netlify/functions/pickem-mail.mjs`) runs every 15 minutes. It sends:

- a **results email** to every player with an email address once all of a week's games are final, and
- a **reminder** 2 hours before the next week's first kickoff, only to players who still have picks to make.

Each email goes to each person once. Players add their own email (they're asked for one at login if
it's missing, and can change it on their Profile page), and the administrator can also set them on
the Admin tab. Only the player, `dakota` and the mailer login can read an address.

1. **Gmail app password.** In the Google account you want to send from, turn on 2-Step Verification,
   then open *Security > App passwords*, create one named "Pick'Em", and copy the 16 letters.
2. **Mailer login.** In Firebase: *Authentication > Users > Add user*, email `mailer@pickem.app`, with
   a password of your choice. It's a read-only login for the email job. Don't add it as a player.
3. **Database rules.** Publish the current `database.rules.json` (Realtime Database > Rules).
4. **Netlify settings.** *Site configuration > Environment variables*, add:

   | Name | Value |
   |---|---|
   | `PICKEM_DB_URL` | your Realtime Database URL |
   | `PICKEM_API_KEY` | Firebase Web API key |
   | `PICKEM_MAILER_PASSWORD` | the mailer login's password |
   | `GMAIL_USER` | the Gmail address that sends |
   | `GMAIL_APP_PASSWORD` | the app password from step 1 |

   Then redeploy (*Deploys > Trigger deploy*).
5. **Test it.** On the Admin tab, save your own email, then tap **Send a test email to me**.

Scheduled functions only run on the live site, not on deploy previews. Netlify's *Logs > Functions* page
shows each run.

## Password resets (one-time setup)

- **Forgot password?** on the login screen emails a one-hour reset link to the player's saved address.
- On the **Admin** tab, the key button next to a player lets `dakota` set a new password for them.

Both need administrator access to Firebase Authentication:

1. In Firebase, open *Project settings > Service accounts* and tap **Generate new private key**. A
   `.json` file downloads.
2. Open that file, copy **all** of its text, and paste it into a new Netlify environment variable named
   `FIREBASE_SERVICE_ACCOUNT`. Then redeploy.
3. Publish the current `database.rules.json`.

Keep that file private: anyone who has it can manage your Firebase project. Delete the download once
it's in Netlify.

## Phone notifications

Each player turns them on from their **Profile** page. On iPhone, notifications only work when Pick'Em
is opened from the Home Screen (Share > Add to Home Screen). Players get:

- a reminder 2 hours before a week's first kickoff, if they still have picks to make, and
- the result of each game they picked, once it's final.

The scheduled job sends them. Its push keys are created automatically on the first run and stored
under `/vapid` (readable only by the mailer login), so there's nothing extra to set up beyond the
email settings above and publishing the current `database.rules.json`.

## Email & notification settings (Admin tab)

`dakota` can change these on the Admin tab without a new build. The scheduled job reads them from
`/settings/notify` every 15 minutes:

- pause everything (kickoff times still save, so picks still lock)
- results email and/or notification, sent as soon as a week is final or after a delay
- reminder email and/or notification, up to four times before kickoff (30 minutes to 2 days),
  before the week's first game or before every game day
- the "your pick won/lost" notification after each game
- the sender name, and a note added to every email
- **Send a reminder now**, to everyone still missing picks

## Admin tools

- **Databases:** create a new database (you're added to it) and switch between them on your Profile page.
- **Players:** add, remove, rename (✎, moves all their picks), and reset a password (🔑).
- **Activity:** admin changes, password resets and manual sends from the last 6 months.
- The scheduled job tidies up once a day: records for weeks over 60 days old, used or expired
  reset links, and activity older than 6 months.
