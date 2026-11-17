// Phone notifications (Web Push). The push keys ("VAPID") are created on first use and kept in
// the database under /vapid, readable only by the mailer login, so there's nothing to set up.
// Each phone's subscription is saved by the app under /push/<username>/<id>.
import webpush from 'web-push';

const E = k => (process.env[k] || '').trim();

/** The push keys, creating them the first time if asked. */
export async function vapidKeys(q, {create = false} = {}) {
  let v = await q('GET', '/vapid').catch(() => null);
  if ((!v || !v.publicKey) && create) {
    try { await q('PUT', '/vapid', webpush.generateVAPIDKeys()); } catch (e) { /* created by another run first */ }
    v = await q('GET', '/vapid').catch(() => null);
  }
  return v && v.publicKey && v.privateKey ? v : null;
}

/** Sends one notification to every phone a player has turned notifications on for. Returns how many got it. */
export async function pushTo(q, keys, user, subs, payload, log = () => {}) {
  webpush.setVapidDetails('mailto:' + (E('GMAIL_USER') || 'admin@pickem.app'), keys.publicKey, keys.privateKey);
  let n = 0;
  for (const [id, sub] of Object.entries(subs || {})) {
    if (!sub || !sub.endpoint || !sub.keys) continue;
    try {
      await webpush.sendNotification({endpoint: sub.endpoint, keys: sub.keys}, JSON.stringify(payload), {TTL: 6 * 3600});
      n++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {        // the phone turned notifications off: forget it
        await q('DELETE', `/push/${user}/${id}`).catch(() => {});
        log(`removed an expired notification subscription for ${user}`);
      } else log(`could not notify ${user}: ${e.statusCode || ''} ${e.message}`);
    }
  }
  return n;
}
