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
- **Administrator:** the `dakota` login can add and remove names, create new logins from the
  Account menu, and remove a login's access to a database. To change the administrator, edit
  `ADMIN` in `phone-app/index.html` and the `dakota@pickem.app` entries in `database.rules.json`.

## Database rules

`database.rules.json` must be pasted into Firebase by hand: **Build > Realtime Database > Rules**,
replace everything, then **Publish**. Firebase does not read the copy in this repo.

## Things to know

- Creating logins in the app uses Firebase's sign-up feature, so it must stay switched on
  (Authentication > Settings > User actions). Anyone who finds the API key could make an account
  too, but it can't see anything until the administrator tags it.
- The app stops picks at kickoff. The database rules don't check kickoff times, so a technical
  user could still change their own pick after a game starts.
