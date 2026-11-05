import { encryptVault, decryptVault, deriveKey, fromBase64, toBase64, validateEnvelope } from './encryption.js';

const PREFIX = 'vaultChunk.';
export function packSync(envelope, revision = crypto.randomUUID()) {
  const text = JSON.stringify(envelope), items = {};
  const chunks = Math.ceil(text.length / 6000);
  for (let i = 0; i < chunks; i++) items[`${PREFIX}${i}`] = text.slice(i * 6000, (i + 1) * 6000);
  items.vaultMeta = { version: 1, revision, chunks, updatedAt: Date.now() };
  const bytes = Object.entries(items).reduce((n, [key, value]) => n + new TextEncoder().encode(key + JSON.stringify(value)).length, 0);
  if (bytes > 95_000) throw new Error('加密账号库超过 Chrome Sync 容量。请使用加密备份。');
  return items;
}

export function unpackSync(items) {
  const meta = items.vaultMeta;
  if (!meta) return null;
  if (meta.version !== 1 || !Number.isInteger(meta.chunks) || meta.chunks < 1 || meta.chunks > 20 || typeof meta.revision !== 'string') throw new Error('云端同步数据无效。');
  let text = '';
  for (let i = 0; i < meta.chunks; i++) {
    if (typeof items[`${PREFIX}${i}`] !== 'string') throw new Error('云端快照尚未完整到达，请稍后重试。');
    text += items[`${PREFIX}${i}`];
  }
  return { envelope: validateEnvelope(JSON.parse(text)), meta };
}

export async function unlockSync(passphrase, vault) {
  const remote = unpackSync(await chrome.storage.sync.get(null));
  const salt = remote ? fromBase64(remote.envelope.salt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(passphrase, salt);
  if (remote) await decryptVault(remote.envelope, key);
  const exported = toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));
  await chrome.storage.session.set({ syncKey: { raw: exported, salt: toBase64(salt), revision: remote?.meta.revision ?? null } });
  // Existing cloud data is pulled explicitly; unlocking never overwrites it.
  if (!remote) await uploadSync(vault);
  return Boolean(remote);
}

async function sessionKey() {
  const { syncKey } = /** @type {{syncKey?:{raw:string,salt:string,revision:string|null}}} */ (await chrome.storage.session.get('syncKey'));
  if (!syncKey) throw new Error('本次浏览器会话尚未解锁同步，请输入口令。');
  const key = await crypto.subtle.importKey('raw', fromBase64(syncKey.raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, state: syncKey };
}

export async function uploadSync(vault) {
  const { key, state } = await sessionKey();
  const { vaultMeta } = /** @type {{vaultMeta?:{revision:string}}} */ (await chrome.storage.sync.get('vaultMeta'));
  if ((vaultMeta?.revision ?? null) !== state.revision) throw new Error('云端已有新版本，请先拉取并核对账号。');
  const envelope = await encryptVault(vault, key, fromBase64(state.salt));
  const items = packSync(envelope);
  await chrome.storage.sync.set(items);
  const all = await chrome.storage.sync.get(null);
  const obsolete = Object.keys(all).filter(k => k.startsWith(PREFIX) && !(k in items));
  if (obsolete.length) await chrome.storage.sync.remove(obsolete);
  await chrome.storage.session.set({ syncKey: { ...state, revision: items.vaultMeta.revision } });
  return items.vaultMeta;
}

export async function downloadSync() {
  const { key, state } = await sessionKey();
  const remote = unpackSync(await chrome.storage.sync.get(null));
  if (!remote) throw new Error('云端还没有加密账号库。');
  if (remote.envelope.salt !== state.salt) throw new Error('云端加密口令已更改，请重新解锁同步。');
  const vault = await decryptVault(remote.envelope, key);
  await chrome.storage.session.set({ syncKey: { ...state, revision: remote.meta.revision } });
  return vault;
}
