import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccount, decodeBase32, encodeBase32, normalizeHost, matchAccount, validateVault, mergeAccounts } from '../src/model.js';
import { generateTOTP } from '../src/totp.js';
import { parseImport, parseMigration } from '../src/import.js';
import { createBackup, openBackup } from '../src/encryption.js';
import { packSync, unpackSync } from '../src/sync.js';

// All keys and passwords below are public synthetic test fixtures.
const make = (overrides = {}) => validateAccount({ username: 'alice@example.com', issuer: 'Example', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', domains: ['login.example.com'], ...overrides });

test('RFC 6238 appendix B: all timestamps and SHA algorithms', async () => {
  const times = [59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000];
  const vectors = {
    SHA1: ['94287082', '07081804', '14050471', '89005924', '69279037', '65353130'],
    SHA256: ['46119246', '68084774', '67062674', '91819424', '90698825', '77737706'],
    SHA512: ['90693936', '25091201', '99943326', '93441116', '38618901', '47863826'],
  };
  for (const [algorithm, expected] of Object.entries(vectors)) {
    const length = { SHA1: 20, SHA256: 32, SHA512: 64 }[algorithm];
    const secret = encodeBase32(new TextEncoder().encode('1234567890'.repeat(7).slice(0, length)));
    const account = make({ algorithm, secret, digits: 8 });
    for (let i = 0; i < times.length; i++) assert.equal(await generateTOTP(account, times[i] * 1000), expected[i]);
  }
  assert.equal(await generateTOTP(make(), 59_000), '287082');
});

test('base32 canonical validation and round trips', () => {
  for (let size = 1; size <= 64; size++) {
    const value = Uint8Array.from({ length: size }, (_, i) => (i * 29 + size) % 256);
    assert.deepEqual(decodeBase32(encodeBase32(value)), value);
  }
  for (const invalid of ['', 'A', 'AB', 'ABC', 'ABCDEF', '11111111', 'AA=BB']) assert.throws(() => decodeBase32(invalid));
  assert.equal(encodeBase32(decodeBase32('my======')), 'MY');
});

test('account boundary validates parameters, domains, and vault IDs', () => {
  for (const overrides of [{ period: 0 }, { period: 3.5 }, { digits: 7 }, { algorithm: 'MD5' }, { secret: '' }, { username: '' }, { domains: 'example.com' }, { labels: [2] }]) assert.throws(() => make(overrides));
  assert.equal(normalizeHost('https://Login.Example.com'), 'login.example.com');
  for (const domain of ['*.example.com', 'example.com/path', 'https://user:pass@example.com', 'ftp://example.com', 'example.com:8080']) assert.throws(() => normalizeHost(domain));
  const item = make(); assert.throws(() => validateVault({ version: 1, accounts: [item, item] }));
});

test('autofill requires an exact host and a unique identity', () => {
  const alice = make(), bob = make({ username: 'bob@example.com' });
  assert.equal(matchAccount([alice, bob], 'login.example.com', ['ALICE@example.com']), alice);
  assert.equal(matchAccount([alice], 'login.example.com.evil.com', ['alice@example.com']), null);
  assert.equal(matchAccount([alice], 'sub.login.example.com', ['alice@example.com']), null);
  assert.equal(matchAccount([alice], 'login.example.com', []), null);
  assert.equal(matchAccount([alice], 'login.example.com', ['someoneelse@example.com']), null);
  assert.equal(matchAccount([alice, make()], 'login.example.com', ['alice@example.com']), null);
  const fallback = make({ allowWithoutUsername: true });
  assert.equal(matchAccount([fallback], 'login.example.com', []), fallback);
  assert.equal(matchAccount([fallback], 'login.example.com', ['other@example.com']), null);
});

test('otpauth import supports issuer, custom parameters, unicode and rejects HOTP', () => {
  const result = parseImport('otpauth://totp/Example:alice%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Example&algorithm=SHA256&digits=8&period=60');
  assert.equal(result.accounts[0].username, 'alice@example.com'); assert.equal(result.accounts[0].period, 60);
  assert.equal(result.accounts[0].algorithm, 'SHA256'); assert.equal(result.accounts[0].digits, 8);
  assert.throws(() => parseImport('otpauth://hotp/test?secret=MY'));
  assert.throws(() => parseImport('https://example.com'));
});

const variable = n => { const result = []; let v = BigInt(n); do { const byte = Number(v & 127n); v >>= 7n; result.push(byte | (v ? 128 : 0)); } while (v); return result; };
const int = (key, value) => [...variable(key * 8), ...variable(BigInt.asUintN(64, BigInt(value)))];
const data = (key, value) => [...variable(key * 8 + 2), ...variable(value.length), ...value];
const str = text => [...new TextEncoder().encode(text)];
function migration({ index = 0, size = 1, type = 2, algorithm = 1, batchId = 1234 } = {}) {
  const account = [...data(1, [...decodeBase32(make().secret)]), ...data(2, str('Example:alice@example.com')), ...data(3, str('Example')), ...int(4, algorithm), ...int(5, 1), ...int(6, type)];
  const payload = [...data(1, account), ...int(2, 1), ...int(3, size), ...int(4, index), ...int(5, batchId)];
  return `otpauth-migration://offline?data=${encodeURIComponent(Buffer.from(payload).toString('base64'))}`;
}
test('Google protobuf migration decodes secrets and batch metadata', () => {
  const result = parseMigration(migration({ index: 1, size: 3 }));
  assert.equal(result.accounts.length, 1); assert.equal(result.accounts[0].secret, make().secret);
  assert.equal(result.accounts[0].username, 'alice@example.com'); assert.deepEqual(result.batch, { id: 1234, size: 3, index: 1 });
  assert.equal(parseMigration(migration({ batchId: -123 })).batch.id, -123);
  for (const input of [migration({ type: 1 }), migration({ algorithm: 4 }), migration({ index: 3, size: 3 }), 'otpauth-migration://offline?data=////', 'otpauth-migration://offline?data=Cv8=']) assert.throws(() => parseMigration(input));
});

test('merge skips duplicate TOTP accounts, preserves metadata, keeps distinct algorithms', () => {
  const original = make({ folder: 'Work' });
  const result = mergeAccounts([original], [make({ folder: 'Other' }), make({ algorithm: 'SHA256' })]);
  assert.equal(result.added, 1); assert.equal(result.accounts[0].folder, 'Work');
});

test('encrypted backups round trip, randomize, and reject wrong passwords and tampering', async () => {
  const vault = { version: 1, accounts: [make({ folder: '测试' })] }, password = 'public-test-passphrase-only';
  const backup = await createBackup(vault, password), another = await createBackup(vault, password);
  assert.notEqual(backup.salt, another.salt); assert.notEqual(backup.iv, another.iv);
  assert.ok(!JSON.stringify(backup).includes(vault.accounts[0].secret));
  assert.deepEqual(await openBackup(backup, password), vault);
  await assert.rejects(openBackup(backup, 'wrong-public-test-password'));
  await assert.rejects(openBackup({ ...backup, ciphertext: (backup.ciphertext[0] === 'A' ? 'B' : 'A') + backup.ciphertext.slice(1) }, password));
  await assert.rejects(openBackup({ ...backup, iterations: 1 }, password));
  await assert.rejects(createBackup(vault, 'short'));
});

test('sync chunking meets per-item quota and rejects oversized or partial snapshots', async () => {
  const backup = await createBackup({ version: 1, accounts: [make()] }, 'public-test-passphrase-only');
  const items = packSync(backup, 'test-revision');
  assert.deepEqual(unpackSync(items).envelope, backup);
  assert.ok(Object.entries(items).every(([key, value]) => Buffer.byteLength(key + JSON.stringify(value)) < 8192));
  assert.throws(() => unpackSync({ vaultMeta: { version: 1, revision: 'x', chunks: 2 }, 'vaultChunk.0': '{}' }));
  assert.throws(() => packSync({ ...backup, ciphertext: 'A'.repeat(100_000) }));
});
