import { chromium } from 'playwright';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import QRCode from 'qrcode';
import { generateTOTP } from '../src/totp.js';
import { validateAccount } from '../src/model.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(`${tmpdir()}/local-authenticator-e2e-`);
const extension = `${temporary}/extension`;
const artifacts = `${root}artifacts`;
await mkdir(artifacts, { recursive: true });
await cp(`${root}dist`, extension, { recursive: true });
const manifest = JSON.parse(await readFile(`${extension}/manifest.json`, 'utf8'));
// This isolated copy pre-grants the local fixture origin and the screenshot
// capability (<all_urls> substitutes for a native context-menu activeTab grant).
// Production has neither: it requires site grants / native menu invocation.
manifest.host_permissions = ['http://127.0.0.1/*', '<all_urls>'];
await writeFile(`${extension}/manifest.json`, JSON.stringify(manifest));
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const PASSWORD = 'public-e2e-passphrase-only';
const otpURI = `otpauth://totp/QR%20Fixture:qr%40example.com?secret=${SECRET}&issuer=QR%20Fixture`;
await QRCode.toFile(`${temporary}/qr.png`, otpURI, { width: 420, margin: 4 });
const vi = n => { const output = []; do { output.push((n & 127) | (n > 127 ? 128 : 0)); n >>>= 7; } while (n); return output; };
const integer = (field, n) => [...vi(field * 8), ...vi(n)];
const bytes = (field, value) => [...vi(field * 8 + 2), ...vi(value.length), ...value];
for (const index of [0, 1]) {
  const account = [...bytes(1, [...new TextEncoder().encode('12345678901234567890')]), ...bytes(2, [...new TextEncoder().encode(`migration-${index}@example.com`)]), ...bytes(3, [...new TextEncoder().encode('Google migration fixture')]), ...integer(4, 1), ...integer(5, 1), ...integer(6, 2)];
  const payload = [...bytes(1, account), ...integer(2, 1), ...integer(3, 2), ...integer(4, index), ...integer(5, 9821)];
  const uri = `otpauth-migration://offline?data=${encodeURIComponent(Buffer.from(payload).toString('base64'))}`;
  await QRCode.toFile(`${temporary}/migration-${index}.png`, uri, { width: 600, margin: 4 });
}
const qrImage = await readFile(`${temporary}/qr.png`);
const input = '<label>验证码<input id="otp" autocomplete="one-time-code" inputmode="numeric" maxlength="6"></label>';
let privacyProbeRequests = 0;
const server = http.createServer((req, res) => {
  if (req.url === '/privacy-probe') { privacyProbeRequests++; res.writeHead(200).end('public probe'); return; }
  if (req.url === '/qr.png') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(qrImage); return; }
  if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
  let html = '';
  if (req.url === '/qr') html = '<h1>Synthetic QR fixture</h1><img src="/qr.png" alt="Test TOTP QR">';
  else if (req.url === '/split') html = '<input type="email" name="email" value="alice@example.com"><fieldset>' + Array.from({ length: 6 }, (_, i) => `<input aria-label="Digit ${i + 1}" inputmode="numeric" maxlength="1">`).join('') + '</fieldset>';
  else if (req.url === '/step1') html = '<form action="/step2"><input name="username" autocomplete="username"><button>Next</button></form>';
  else if (req.url === '/step2') html = input;
  else if (req.url === '/dynamic') html = '<input type="email" name="email" value="alice@example.com"><button id="reveal" onclick="document.querySelector(\'main\').innerHTML=\'' + input.replaceAll('"', '&quot;') + '\'">Reveal</button><main></main>';
  else html = `<input type="email" name="email" value="${req.url === '/wrong' ? 'other' : 'alice'}@example.com">${input}`;
  res.writeHead(200, { 'Content-Type': 'text/html;charset=utf-8' }); res.end(`<!doctype html><html><head><title>Local test fixture</title></head><body>${html}</body></html>`);
});
await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
const address = `http://127.0.0.1:${server.address().port}`;
let context;
const checks = [];
const verify = (condition, message) => { if (!condition) throw new Error(message); };
try {
  context = await chromium.launchPersistentContext(`${temporary}/profile`, {
    channel: 'chromium', headless: true, viewport: { width: 1920, height: 1080 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  context.setDefaultTimeout(12_000);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  await worker.evaluate(() => {
    globalThis.__cloudApiCalls = 0;
    const area = chrome.storage.sync;
    for (const method of ['get', 'set', 'remove', 'clear', 'getBytesInUse', 'setAccessLevel']) {
      const blocked = () => { globalThis.__cloudApiCalls++; throw new Error('Cloud storage access is forbidden in this test.'); };
      area[method] = blocked;
      if (area[method] !== blocked) throw new Error('Could not install the cloud storage audit trap.');
    }
  });
  const extensionId = new URL(worker.url()).host;
  const ui = await context.newPage();
  const errors = [];
  ui.on('pageerror', () => errors.push('pageerror'));
  await ui.goto(`chrome-extension://${extensionId}/popup.html`);
  await ui.locator('#empty').waitFor({ state: 'visible' });
  const call = async (type, data = {}) => {
    const response = await ui.evaluate(message => chrome.runtime.sendMessage(message), { type, ...data });
    verify(response?.ok, `Extension operation failed: ${type}`); return response.data;
  };
  await ui.locator('#add-account').click();
  await ui.locator('[name=issuer]').fill('Local fixture');
  await ui.locator('[name=username]').fill('alice@example.com');
  await ui.locator('[name=secret]').fill(SECRET);
  await ui.locator('[name=domains]').fill('127.0.0.1');
  await ui.locator('[name=folder]').fill('测试');
  await ui.locator('[name=labels]').fill('RFC, 自动填充');
  await ui.getByRole('button', { name: '保存账号', exact: true }).click();
  await ui.locator('.account').waitFor();
  await ui.waitForFunction(() => /^\d{3} \d{3}$/.test(document.querySelector('.code')?.textContent ?? ''));
  verify((await call('STATE')).vault.accounts.length === 1, 'Account save did not persist');
  await ui.locator('.pin').click();
  await ui.waitForFunction(() => document.querySelector('.pin')?.classList.contains('active'));
  await ui.locator('#search').fill('no-such-account');
  await ui.locator('#empty').waitFor({ state: 'visible' });
  await ui.locator('#search').fill('');
  await ui.locator('.account').waitFor();
  checks.push('actual MV3 worker + account CRUD UI, search, labels and pin');
  const screenshotPage = await context.newPage();
  await screenshotPage.goto(`chrome-extension://${extensionId}/popup.html`);
  await screenshotPage.locator('.account').waitFor();
  await screenshotPage.setViewportSize({ width: 420, height: 800 });
  await screenshotPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await screenshotPage.screenshot({ path: `${artifacts}/popup.png`, animations: 'disabled' });
  await screenshotPage.close();

  await call('REGISTER');
  const registrations = await worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());
  verify(registrations.some(x => x.matches.includes('http://127.0.0.1/*')), 'Granted site was not registered');
  const login = await context.newPage();
  await login.goto(`${address}/login`);
  await login.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#otp').value), { timeout: 12_000 });
  const expected = await generateTOTP(validateAccount({ username: 'alice', secret: SECRET }));
  verify((await login.locator('#otp').inputValue()) === expected, 'Autofill produced an unexpected TOTP');
  await login.locator('#otp').fill('123');
  await login.waitForTimeout(1700);
  verify((await login.locator('#otp').inputValue()) === '123', 'Autofill overwrote manual input');
  checks.push('exact-host/username autofill + preservation of manual input');

  await login.goto(`${address}/wrong`);
  await login.waitForTimeout(1800);
  verify((await login.locator('#otp').inputValue()) === '', 'Wrong username was filled');
  await login.goto(`${address}/split`);
  await login.waitForFunction(() => [...document.querySelectorAll('fieldset input')].every(x => /^\d$/.test(x.value)), { timeout: 12_000 });
  checks.push('wrong-username rejection + six-field OTP');

  await login.goto(`${address}/step1`);
  await login.locator('[name=username]').fill('alice@example.com');
  await login.getByRole('button', { name: 'Next' }).click();
  await login.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#otp')?.value ?? ''), { timeout: 12_000 });
  checks.push('same-origin multi-step login username memory');

  await login.goto(`${address}/dynamic`);
  await login.locator('#reveal').click();
  await login.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#otp')?.value ?? ''), { timeout: 12_000 });
  checks.push('MutationObserver detects dynamically inserted OTP fields');

  await call('SETTINGS', { autofill: false });
  await login.goto(`${address}/login`);
  await login.waitForTimeout(1800);
  verify((await login.locator('#otp').inputValue()) === '', 'Disabled autofill still filled');
  await call('SETTINGS', { autofill: true });
  await login.waitForFunction(() => /^\d{6}$/.test(document.querySelector('#otp').value), { timeout: 12_000 });
  checks.push('autofill switch takes effect in an existing page');

  await ui.bringToFront();
  await ui.getByRole('button', { name: '导入', exact: true }).click();
  await ui.locator('#qr-files').setInputFiles(`${temporary}/qr.png`);
  await ui.locator('#import-preview').waitFor({ state: 'visible' });
  verify(await ui.locator('#import-accounts li').count() === 1, 'Local QR decode failed');
  await ui.locator('#confirm-import').click();
  await ui.waitForFunction(() => document.querySelector('#count')?.textContent === '2');
  checks.push('actual local image upload, jsQR decode, preview, import');

  await ui.getByRole('button', { name: '导入', exact: true }).click();
  await ui.locator('#qr-files').setInputFiles(`${temporary}/migration-0.png`);
  await ui.waitForFunction(() => document.querySelector('#batch-status').textContent.includes('1 / 2'));
  verify(await ui.locator('#confirm-import').isDisabled(), 'Partial Google migration was allowed to import');
  await ui.locator('#qr-files').setInputFiles(`${temporary}/migration-1.png`);
  await ui.waitForFunction(() => document.querySelector('#batch-status').textContent.includes('2 / 2'));
  verify(await ui.locator('#confirm-import').isEnabled(), 'Complete Google migration remained blocked');
  await ui.locator('#confirm-import').click();
  await ui.waitForFunction(() => document.querySelector('#count')?.textContent === '4');
  checks.push('Google migration QR batch waits for all parts and imports all accounts');

  const encrypted = await call('BACKUP', { passphrase: PASSWORD });
  verify(!JSON.stringify(encrypted).includes(SECRET), 'Backup leaked a plaintext secret');
  const before = (await call('STATE')).vault.accounts.length;
  const bad = await ui.evaluate(async ({ encrypted, PASSWORD }) => chrome.runtime.sendMessage({ type: 'RESTORE', envelope: encrypted, passphrase: PASSWORD + 'wrong' }), { encrypted, PASSWORD });
  verify(!bad.ok, 'Wrong backup password was accepted');
  verify((await call('STATE')).vault.accounts.length === before, 'Failed restore mutated the vault');
  const id = (await call('STATE')).vault.accounts.find(x => x.username === 'qr@example.com').id;
  await call('DELETE', { id });
  verify((await call('RESTORE', { envelope: encrypted, passphrase: PASSWORD })).added === 1, 'Restore failed to merge missing account');
  await ui.getByRole('button', { name: '本地备份', exact: true }).click();
  await ui.locator('#backup-passphrase').fill(PASSWORD);
  await ui.locator('#backup-confirm').fill(PASSWORD);
  const downloaded = ui.waitForEvent('download');
  await ui.locator('#export-backup').click();
  const download = await downloaded;
  const file = await download.path();
  const exported = JSON.parse(await readFile(file, 'utf8'));
  verify(exported.format === 'local-authenticator' && !JSON.stringify(exported).includes(SECRET), 'Backup download is not encrypted');
  checks.push('encrypted backup file download, bad-password rejection, merge restore');

  verify(await ui.locator('[id*="sync"]').count() === 0, 'Cloud sync controls are still present');
  for (const type of ['SYNC_UNLOCK', 'SYNC_UPLOAD', 'SYNC_DOWNLOAD', 'SYNC_LOCK']) {
    const response = await ui.evaluate(message => chrome.runtime.sendMessage(message), { type, passphrase: PASSWORD });
    verify(response?.ok === false, 'A removed cloud sync command was accepted');
  }
  checks.push('cloud sync controls removed and all legacy sync commands rejected');

  const networkGuard = await ui.evaluate(async url => {
    const violation = new Promise(resolve => addEventListener('securitypolicyviolation', event => resolve(event.effectiveDirective), { once: true }));
    const rejected = await fetch(url, { method: 'POST', body: 'public-network-probe' }).then(() => false, () => true);
    return { rejected, directive: rejected ? await violation : null };
  }, `${address}/privacy-probe`);
  verify(networkGuard.rejected && networkGuard.directive === 'connect-src' && privacyProbeRequests === 0, 'Extension CSP allowed a network POST');
  checks.push('connect-src none blocks an extension-page network POST before reaching the server');

  await login.bringToFront(); await login.goto(`${address}/qr`);
  const screenshot = await worker.evaluate(async () => {
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  });
  await worker.evaluate(async image => {
    await chrome.storage.session.set({ 'capture.fixture': { image, host: '127.0.0.1' } });
  }, screenshot);
  const scanner = await context.newPage();
  await scanner.goto(`chrome-extension://${extensionId}/popup.html?capture=fixture`);
  await scanner.locator('#import-preview').waitFor({ state: 'visible' });
  verify((await scanner.locator('#import-domains').inputValue()) === '127.0.0.1', 'Capture lost source hostname');
  const consumed = await worker.evaluate(() => chrome.storage.session.get('capture.fixture'));
  verify(!consumed['capture.fixture'], 'Consumed screenshot was retained');
  checks.push('real captureVisibleTab → screenshot QR decode → import preview');

  // A content script cannot read local secrets or invoke privileged UI actions.
  await login.goto(`${address}/login`);
  const security = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: async () => {
      let blocked = false;
      try { await chrome.storage.local.get('vault'); } catch { blocked = true; }
      const privileged = await chrome.runtime.sendMessage({ type: 'BACKUP', passphrase: 'public-e2e-passphrase-only' }).catch(() => null);
      return { blocked, privileged: Boolean(privileged?.ok) };
    } });
    return result.result;
  });
  verify(security.blocked && !security.privileged, 'Untrusted content obtained privileged vault access');
  verify(errors.length === 0, 'Extension UI raised a page error');
  verify(await worker.evaluate(() => globalThis.__cloudApiCalls) === 0, 'Runtime touched Chrome cloud storage');
  checks.push('content storage isolation and privileged-message rejection');
  checks.push('account operations, local QR capture, encrypted export/restore, and removed commands never access cloud storage');
  await writeFile(`${artifacts}/e2e-results.json`, JSON.stringify({ passed: true, checks, scope: 'isolated headless Chromium, public synthetic data; local fixture host and screenshot permission pre-granted only in test copy; no real Google account, native host-permission dialog, or native context-menu click' }, null, 2));
  console.log(`Passed ${checks.length} extension E2E checks. Evidence: artifacts/e2e-results.json`);
} finally {
  if (context) await context.close();
  await new Promise(resolve => server.close(resolve));
  await rm(temporary, { recursive: true, force: true });
}
