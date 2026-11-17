// Runs every 15 minutes on Netlify (production deploys only).
// Sends "week is final" emails and the 2-hours-before-kickoff reminder.
import {runOnce, missingSettings} from './lib/pickem.mjs';

export default async () => {
  const missing = missingSettings();
  if (missing.length) {
    console.log('Reminder emails are not set up yet. Missing environment variables: ' + missing.join(', '));
    return new Response('not configured');
  }
  const n = await runOnce();
  console.log(`reminder emails sent: ${n}`);
  return new Response('ok');
};

export const config = {schedule: '*/15 * * * *'};
