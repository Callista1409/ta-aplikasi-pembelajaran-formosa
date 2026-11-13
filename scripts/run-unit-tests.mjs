import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = ['scripts', 'admin-backend', 'server'].flatMap(directory =>
  readdirSync(new URL(`../${directory}/`, import.meta.url))
    .filter(name => name.endsWith('.test.mjs') && !name.includes('emulator') && name !== 'firestore-rules-stage2.test.mjs')
    .map(name => `${directory}/${name}`),
);
const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: new URL('../', import.meta.url),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
