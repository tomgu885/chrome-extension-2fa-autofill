import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));

test('tagged releases require the same stable version in the package and manifest', async () => {
  const folder = await mkdtemp(`${tmpdir()}/authenticator-version-`);
  try {
    await mkdir(`${folder}/scripts`); await mkdir(`${folder}/src`);
    await copyFile(`${root}scripts/check-version.mjs`, `${folder}/scripts/check-version.mjs`);
    await writeFile(`${folder}/package.json`, JSON.stringify({ version: '2.3.4' }));
    await writeFile(`${folder}/src/manifest.json`, JSON.stringify({ version: '2.3.4' }));
    const run = (tag, type = 'tag') => spawnSync(process.execPath, [`${folder}/scripts/check-version.mjs`], {
      env: { ...process.env, GITHUB_REF_TYPE: type, GITHUB_REF_NAME: tag, GITHUB_OUTPUT: `${folder}/outputs` }, stdio: 'pipe',
    });
    assert.equal(run('v2.3.4').status, 0);
    assert.equal(await readFile(`${folder}/outputs`, 'utf8'), 'version=2.3.4\n');
    for (const tag of ['v2.3.5', 'v2.3.4-beta', 'v2.03.4']) assert.notEqual(run(tag).status, 0);
    assert.equal(run('development', 'branch').status, 0);
    await writeFile(`${folder}/src/manifest.json`, JSON.stringify({ version: '2.3.5' }));
    assert.notEqual(run('v2.3.4').status, 0);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('release preparation preserves tested bytes and supports future versions without rewriting links', async () => {
  const folder = await mkdtemp(`${tmpdir()}/authenticator-release-`);
  try {
    // Small public fixture: prepare-release preserves an opaque archive byte for byte.
    const fixture = new Uint8Array([80, 75, 5, 6, ...new Array(18).fill(0)]);
    const digest = createHash('sha256').update(fixture).digest('hex');
    for (const version of ['1.0.1', '2.3.4']) {
      await writeFile(`${folder}/local-authenticator-${version}.zip`, fixture);
      execFileSync(process.execPath, [`${root}scripts/prepare-release.mjs`, version, folder], { env: { ...process.env, EXPECTED_DIGEST: `sha256:${digest}` }, stdio: 'pipe' });
      assert.deepEqual(new Uint8Array(await readFile(`${folder}/local-authenticator.zip`)), fixture);
      const sums = await readFile(`${folder}/SHA256SUMS.txt`, 'utf8');
      assert.ok(sums.includes(`${digest}  local-authenticator-${version}.zip\n`));
      assert.ok(sums.includes(`${digest}  local-authenticator.zip\n`));
      assert.ok((await readFile(`${folder}/release-notes.md`, 'utf8')).includes(`/blob/v${version}/README.md`));
    }
    await rm(`${folder}/local-authenticator.zip`);
    const invalid = spawnSync(process.execPath, [`${root}scripts/prepare-release.mjs`, '2.3.4', folder], { env: { ...process.env, EXPECTED_DIGEST: '0'.repeat(64) }, stdio: 'pipe' });
    assert.notEqual(invalid.status, 0);
    await assert.rejects(access(`${folder}/local-authenticator.zip`));
  } finally { await rm(folder, { recursive: true, force: true }); }
});
