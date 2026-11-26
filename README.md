# NFL Pick'Em

A web app for weekly NFL picks, plus a College Football Playoff page. Netlify publishes the
`phone-app` folder (see `netlify.toml`). Logins and picks are stored in Firebase. Files outside
`phone-app` never go on the website.

## How access works

- **Logins:** usernames become Firebase accounts named `<username>@pickem.app`.
- **Databases:** a login only sees a database (league) when it's tagged with
  `access/<username>/leagues/<league> = true`. A login with no tag sees nothing.
- **Players:** a name on a league's list belongs to the login with the same name (capitals
  don't matter). Each person can only make picks for their own name, and the database rules
  enforce this.
- **Administrator:** `dakota` opens the **Admin** page by tapping their name at the top right, then
  **Admin** (Profile | Admin). To change the administrator, edit `ADMIN` in `phone-app/index.html`
  and `netlify/functions/lib/pickem.mjs`, and the `dakota@pickem.app` entries in `database.rules.json`.
- The app reads the Firebase database URL and Web API key from Netlify (`PICKEM_DB_URL`,
  `PICKEM_API_KEY`, through `/api/config`), so the login screen only asks for a username and password.

## Database rules

`database.rules.json` holds the database's security rules. After an update, install them from the
app: **Admin > Database rules > Install** (it also says whether the installed rules are up to date).
This needs `FIREBASE_SERVICE_ACCOUNT` (see Password resets below).

## Things to know

- Creating logins on the Admin page goes through the server (it needs `FIREBASE_SERVICE_ACCOUNT`).
  With that set up, switch off Firebase's public sign-up so nobody else can make accounts:
  Authentication > Settings > User actions > untick **Enable create (sign-up)**.
- Picks lock at kickoff, in the app and in the database rules (the email job saves each game's
  kickoff time).
- The weeks come from ESPN's calendar: preseason, Weeks 1-18, then Wild Card, Divisional,
  Conference Championship and Super Bowl. The Pro Bowl is skipped.
- Preseason picks count only toward the **Preseason rankings** on Standings, and no emails or
  notifications go out for the preseason.
- In the offseason the app opens on last season's Super Bowl with an offseason note.
- `phone-app/_headers` adds security headers to every page: the app can't be shown inside another
  site, and scripts and connections are limited to this site, Firebase and ESPN. If the app ever
  needs a new outside address, add it to the `Content-Security-Policy` line there.

## Reminder emails (one-time setup)

A scheduled Netlify function (`netlify/functions/pickem-mail.mjs`) runs every 15 minutes. It sends
**results emails** once a week is final and **reminders** before kickoff to players still missing
picks. Each email goes to each person once. Players add their own email (they're asked for one at
login), and the administrator can also set them on the Admin page.

1. **Gmail app password.** In the Google account you want to send from, turn on 2-Step Verification,
   then open *Security > App passwords*, create one named "Pick'Em", and copy the 16 letters.
2. **Mailer login.** In Firebase: *Authentication > Users > Add user*, email `mailer@pickem.app`, with
   a password of your choice. It's a read-only login for the email job. Don't add it as a player.
3. **Netlify settings.** *Site configuration > Environment variables*, add:

   | Name | Value |
   |---|---|
   | `PICKEM_DB_URL` | your Realtime Database URL |
   | `PICKEM_API_KEY` | Firebase Web API key |
   | `PICKEM_MAILER_PASSWORD` | the mailer login's password |
   | `GMAIL_USER` | the Gmail address that sends |
   | `GMAIL_APP_PASSWORD` | the app password from step 1 |

   Then redeploy (*Deploys > Trigger deploy*).
4. **Test it.** On the Admin page, save your own email, then tap **Send a test email to me**.

Scheduled functions only run on the live site, not on deploy previews. Netlify's *Logs > Functions*
page shows each run.

## Password resets (one-time setup)

- **Forgot password?** on the login screen emails a one-hour reset link to the player's saved address.
  The player always sees the same reply, but **Activity** on the Admin page (and the `reset-request`
  log under *Netlify > Logs > Functions*) says what happened.
- On the Admin page, the key button next to a player lets `dakota` set a new password for them.

Both need `FIREBASE_SERVICE_ACCOUNT`: in Firebase, *Project settings > Service accounts > Generate new
private key*, then paste **all** of the downloaded file's text into a Netlify environment variable
with that name and redeploy. Keep that file private (anyone who has it can manage your Firebase
project) and delete the download once it's in Netlify.

## Phone notifications

Each player turns them on from their **Profile** page. On iPhone, notifications only work when Pick'Em
is opened from the Home Screen (Share > Add to Home Screen). The scheduled job sends them; its push
keys are created automatically on the first run and stored under `/vapid`.

## Who gets what

- **Admin > Emails & notifications** (`/settings/notify`) sets what goes out for everyone: pause
  everything, results and reminders (email and/or notification, timing, up to four reminders), the
  "your pick won/lost" notification, the sender name and a note, and **Send a reminder now**.
- **Profile > What you get** (`/prefs/<username>`) lets each player turn off any email or
  notification for themselves (NFL results, reminders, game results, CFP bracket). Anything a player
  hasn't turned off is on.

## College Football Playoff page

The **NFL | CFP** switch at the top opens the CFP page (the app always opens on NFL). It uses the
same logins and player list as the Pick'Em database. Its tabs:

- **Live:** College Football Playoff games and games with a Top 25 team, with play-by-play. (The NFL
  Live tab stays NFL-only.)
- **Top 25:** the committee's CFP ranking during the season, the AP Top 25 the rest of the year.
- **Bracket:** before Selection Sunday, a projected bracket "if the season ended this week" from that
  week's Top 25, with arrows to earlier weeks. Once ESPN lists all 12 teams, everyone gets an email
  and a notification, and each player picks all 11 games plus a tiebreaker (title-game total), one
  game at a time with each matchup's stats or on the full bracket. Brackets lock at the first
  kickoff (in the database rules too) and stay hidden from other players until then.
- **Leaderboard:** points, then most points still possible, then the closest tiebreaker.

**Admin > College Football Playoff** turns the page on or off, picks the scoring (classic doubling
1/2/4/8, flat, gentle ramp 1/2/3/5, upset bonus, or seed multiplier), and shows who has finished.
The bracket logic is in `phone-app/cfp-core.js`, shared by the app and the email job.

## Admin tools

- **Databases:** create a new database (you're added to it) and switch between them on your Profile page.
- **Players:** add, remove, rename (✎, moves all their picks and brackets), and reset a password (🔑).
- **Season archive:** save a season's final standings for good (they show under **Past seasons** on
  Standings for everyone), or download any season's standings as a CSV spreadsheet.
- **Activity:** admin changes, password resets and manual sends from the last 6 months.
- The scheduled job tidies up once a day: records for weeks over 60 days old, used or expired
  reset links, and activity older than 6 months.
