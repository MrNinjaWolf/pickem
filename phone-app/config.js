// Optional. Normally the app reads these from the site's Netlify settings (PICKEM_DB_URL and
// PICKEM_API_KEY) through /api/config, so this file can stay blank. Fill them in only if you host
// the app somewhere without those functions. Neither value is a password.
window.PICKEM_CONFIG = {
  databaseUrl: "",   // e.g. "https://your-project-default-rtdb.firebaseio.com"
  apiKey: ""         // Firebase console > Project settings > General > Web API Key
};
