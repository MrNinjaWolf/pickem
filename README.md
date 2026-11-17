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

## Database rules

`database.rules.json` must be pasted into Firebase by hand: **Build > Realtime Database > Rules**,
replace everything, then **Publish**. Firebase does not read the copy in this repo.

## Things to know

- Creating logins in the app uses Firebase's sign-up feature, so it must stay switched on
  (Authentication > Settings > User actions). Anyone who finds the API key could make an account
  too, but it can't see anything until the administrator tags it.
- The app stops picks at kickoff. The database rules don't check kickoff times, so a technical
  user could still change their own pick after a game starts.

## Reminder emails (one-time setup)

A scheduled Netlify function (`netlify/functions/pickem-mail.mjs`) runs every 15 minutes. It sends:

- a **results email** to every player with an email address once all of a week's games are final, and
- a **reminder** 2 hours before the next week's first kickoff, only to players who still have picks to make.

Each email goes to each person once. Emails are set on the Admin tab, and only `dakota` and the
mailer login can read them.

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
