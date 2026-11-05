import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

test('runtime source has no cloud storage, seed upload commands, or network API', async () => {
  for (const filename of await readdir(new URL('../src/', import.meta.url))) {
    if (!filename.endsWith('.js')) continue;
    const source = await readFile(new URL(`../src/${filename}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bstorage\s*\.\s*sync\b|\bSYNC_(?:UNLOCK|LOCK|UPLOAD|DOWNLOAD)\b/, filename);
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/, filename);
  }
  const manifest = JSON.parse(await readFile(new URL('../src/manifest.json', import.meta.url), 'utf8'));
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'(?:;|$)/);
  const html = await readFile(new URL('../src/popup.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /(?:sync-passphrase|unlock-sync|upload-sync|download-sync|lock-sync|Chrome 加密同步)/);
  assert.match(html, /本地备份/);
});
