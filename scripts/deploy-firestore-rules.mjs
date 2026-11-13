import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JWT } from 'google-auth-library';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const serviceAccountPath = resolve(
  projectRoot,
  process.env.FIREBASE_SERVICE_ACCOUNT ?? 'firebase-service-account.json',
);
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
const projectId = serviceAccount.project_id ?? 'formosa-mandarin';
const rules = readFileSync(resolve(projectRoot, 'firestore.rules'), 'utf8');

const client = new JWT({
  email: serviceAccount.client_email,
  key: serviceAccount.private_key,
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});
const { access_token: accessToken } = await client.authorize();
const headers = {
  authorization: `Bearer ${accessToken}`,
  'content-type': 'application/json',
};

async function request(url, options) {
  const response = await fetch(url, { ...options, headers: { ...headers, ...options?.headers } });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(data)}`);
  }
  return data;
}

const ruleset = await request(`https://firebaserules.googleapis.com/v1/projects/${projectId}/rulesets`, {
  method: 'POST',
  body: JSON.stringify({
    source: {
      files: [{ name: 'firestore.rules', content: rules }],
    },
  }),
});

await request(`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`, {
  method: 'PATCH',
  body: JSON.stringify({
    release: {
      name: `projects/${projectId}/releases/cloud.firestore`,
      rulesetName: ruleset.name,
    },
    updateMask: 'rulesetName',
  }),
});

console.log(`Firestore rules deployed: ${ruleset.name}`);
