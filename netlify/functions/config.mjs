// GET /api/config: the Firebase database URL and Web API key from the site's Netlify settings,
// so the login screen doesn't have to ask for them. Neither value is secret: every browser that
// opens the app receives them anyway.
export default async () => new Response(JSON.stringify({
  databaseUrl: (process.env.PICKEM_DB_URL || '').trim(),
  apiKey: (process.env.PICKEM_API_KEY || '').trim()
}), {headers: {'content-type': 'application/json', 'cache-control': 'public, max-age=300'}});

export const config = {path: '/api/config'};
