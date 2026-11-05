import { readFile, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(`${root}package.json`, 'utf8'));
const manifest = JSON.parse(await readFile(`${root}src/manifest.json`, 'utf8'));
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || manifest.version !== version) {
  throw new Error('package.json and src/manifest.json must use the same stable X.Y.Z version.');
}
if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${version}`) {
  throw new Error('Version tag must equal v<package.json version>; no release was prepared.');
}
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `version=${version}\n`);
console.log('Package, manifest, and version tag checks passed.');
