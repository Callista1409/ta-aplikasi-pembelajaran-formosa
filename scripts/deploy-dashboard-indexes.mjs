// Adds only required indexes. Never deletes existing indexes. Default is a dry run.
import { readFileSync } from 'node:fs';
import { JWT } from 'google-auth-library';
const root = new URL('../', import.meta.url);
const account = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ?? readFileSync(new URL(process.env.FIREBASE_SERVICE_ACCOUNT ?? 'firebase-service-account.json', root), 'utf8'));
const definitions = JSON.parse(readFileSync(new URL('firestore.dashboard.indexes.json', root), 'utf8')).indexes;
const client = new JWT({ email: account.client_email, key: account.private_key, scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
const { access_token } = await client.authorize();
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' } });
  const data = await response.json();
  if (!response.ok) throw Error(`Index API HTTP ${response.status}: ${data.error?.status ?? 'unknown'}`);
  return data;
}
for (const group of [...new Set(definitions.map(value => value.collectionGroup))]) {
  const endpoint = `https://firestore.googleapis.com/v1/projects/${account.project_id}/databases/(default)/collectionGroups/${group}/indexes`;
  const existing = [];
  let token;
  do { const page = await request(endpoint + (token ? `?pageToken=${encodeURIComponent(token)}` : '')); existing.push(...(page.indexes ?? [])); token = page.nextPageToken; } while (token);
  for (const index of definitions.filter(value => value.collectionGroup === group)) {
    const signature = fields => JSON.stringify(fields.filter(field => field.fieldPath !== '__name__').map(field => [field.fieldPath, field.order]));
    // ListIndexes can return indexes from other collection groups. Equal fields
    // do not make a flashcards index usable by a questions query.
    const match = existing.find(value => value.name?.split('/collectionGroups/')[1]?.split('/')[0] === group
      && value.queryScope === index.queryScope && signature(value.fields) === signature(index.fields));
    if (match && match.state !== 'NEEDS_REPAIR') { console.log(`${group}: ${match.state} ${index.fields.map(field => field.fieldPath).join(',')}`); continue; }
    if (match) throw Error(`Repair the existing ${group} index in Google Cloud before retrying.`);
    if (!process.argv.includes('--apply')) { console.log(`Would create ${group}: ${index.fields.map(field => field.fieldPath).join(',')}`); continue; }
    await request(endpoint, { method: 'POST', body: JSON.stringify({ queryScope: index.queryScope, fields: index.fields }) });
    console.log(`Creating ${group}: ${index.fields.map(field => field.fieldPath).join(',')}`);
  }
}
console.log('Existing indexes are preserved. Wait for all required indexes to reach READY before deploying the dashboard.');
