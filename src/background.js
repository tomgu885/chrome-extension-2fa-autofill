import { EMPTY_VAULT, validateAccount, mergeAccounts, matchAccount } from './model.js';
import { generateTOTP } from './totp.js';
import { createBackup, openBackup } from './encryption.js';
import { unlockSync, uploadSync, downloadSync } from './sync.js';

const defaults = { autofill: true };
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.sync.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
]);

/** @returns {Promise<{version:number,accounts:import('./model.js').Account[]}>} */
async function readVault() {
  const data = /** @type {{vault?:{version:number,accounts:import('./model.js').Account[]}}} */ (await chrome.storage.local.get('vault'));
  return data.vault ?? structuredClone(EMPTY_VAULT);
}
async function saveVault(vault) { await chrome.storage.local.set({ vault }); }

let siteRegistration = Promise.resolve();
function registerSites() {
  // Grant events and the requesting UI both refresh registrations.
  const run = async () => {
    await chrome.scripting.unregisterContentScripts();
    const { origins = [] } = await chrome.permissions.getAll();
    const matches = origins.filter(x => /^https?:\/\//.test(x));
    if (matches.length) await chrome.scripting.registerContentScripts([{ id: 'otp-fields', matches, js: ['content.js'], runAt: 'document_idle', allFrames: true, persistAcrossSessions: true }]);
  };
  siteRegistration = siteRegistration.then(run, run);
  return siteRegistration;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'scan-qr', title: '添加此处的 2FA 二维码', contexts: ['all'], documentUrlPatterns: ['https://*/*', 'http://*/*'] }));
  void registerSites();
});
chrome.runtime.onStartup.addListener(() => { void registerSites(); });
chrome.permissions.onAdded.addListener(() => { void registerSites(); });
chrome.permissions.onRemoved.addListener(() => { void registerSites(); });
chrome.tabs.onRemoved.addListener(tabId => { void chrome.storage.session.remove(`login.${tabId}`); });

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'scan-qr' || !tab?.id) return;
  void (async () => {
    await ready;
    // Capture the visible page locally, including canvas and cross-origin images.
    // No QR image URL or secret is fetched or transmitted to a server.
    try {
      const active = await chrome.tabs.get(tab.id);
      if (!active.active) throw new Error('请在当前标签页重试。');
      const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      const token = crypto.randomUUID();
      await chrome.storage.session.set({ [`capture.${token}`]: { image, host: new URL(tab.url).hostname } });
      await chrome.tabs.create({ url: chrome.runtime.getURL(`popup.html?capture=${token}`) });
    } catch {
      await chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?captureError=1') });
    }
  })();
});

async function handleContent(message, sender) {
  if (!sender.tab?.id || !sender.url) throw new Error('无效的页面请求。');
  const url = new URL(sender.url);
  if (!['https:', 'http:'].includes(url.protocol)) return null;
  // Ignore cross-origin iframes: a parent login must never leak a code to them.
  if (!sender.tab.url || new URL(sender.tab.url).origin !== url.origin) return null;
  // Already injected scripts can outlive a permission removal until navigation.
  if (!await chrome.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })) return null;
  const key = `login.${sender.tab.id}`;
  if (message.type === 'REMEMBER_USER') {
    if (typeof message.username !== 'string' || !message.username.trim() || message.username.length > 500) return null;
    await chrome.storage.session.set({ [key]: { origin: url.origin, username: message.username.trim(), time: Date.now() } });
    return null;
  }
  const { settings = defaults } = /** @type {{settings?:{autofill:boolean}}} */ (await chrome.storage.local.get('settings'));
  if (!settings.autofill) return null;
  const names = Array.isArray(message.usernames) ? message.usernames.filter(x => typeof x === 'string' && x.length <= 500).slice(0, 20) : [];
  const cached = /** @type {{origin:string,time:number,username:string}|undefined} */ ((await chrome.storage.session.get(key))[key]);
  if (!names.length && cached?.origin === url.origin && Date.now() - cached.time < 10 * 60_000) names.push(cached.username);
  const account = matchAccount((await readVault()).accounts, url.hostname, names);
  if (!account) return null;
  // Let the page retry after a period boundary instead of filling a near-expired code.
  if (account.period - (Date.now() / 1000 % account.period) < 4) return null;
  return { code: await generateTOTP(account) };
}

async function handleUI(message) {
  const vault = await readVault();
  switch (message.type) {
    case 'STATE': {
      const { settings = defaults } = await chrome.storage.local.get('settings');
      const { syncKey } = await chrome.storage.session.get('syncKey');
      const { vaultMeta } = await chrome.storage.sync.get('vaultMeta');
      const { origins = [] } = await chrome.permissions.getAll();
      return { vault, settings, origins, syncUnlocked: Boolean(syncKey), syncMeta: vaultMeta ?? null };
    }
    case 'SAVE': {
      const account = validateAccount(message.account);
      const index = vault.accounts.findIndex(x => x.id === account.id);
      if (index < 0) vault.accounts.push(account); else vault.accounts[index] = account;
      await saveVault(vault); return null;
    }
    case 'DELETE':
      vault.accounts = vault.accounts.filter(x => x.id !== message.id);
      await saveVault(vault); return null;
    case 'IMPORT': {
      if (!Array.isArray(message.accounts) || !message.accounts.length) throw new Error('没有可导入的账号。');
      const result = mergeAccounts(vault.accounts, message.accounts.map(validateAccount));
      await saveVault({ version: 1, accounts: result.accounts }); return { added: result.added };
    }
    case 'SETTINGS':
      await chrome.storage.local.set({ settings: { autofill: message.autofill === true } }); return null;
    case 'BACKUP': return createBackup(vault, message.passphrase);
    case 'RESTORE': {
      const imported = await openBackup(message.envelope, message.passphrase);
      const result = mergeAccounts(vault.accounts, imported.accounts);
      await saveVault({ version: 1, accounts: result.accounts }); return { added: result.added };
    }
    case 'SYNC_UNLOCK': return { remoteExists: await unlockSync(message.passphrase, vault) };
    case 'SYNC_LOCK': await chrome.storage.session.remove('syncKey'); return null;
    case 'SYNC_UPLOAD': return uploadSync(vault);
    case 'SYNC_DOWNLOAD': {
      const remote = await downloadSync();
      const result = mergeAccounts(vault.accounts, remote.accounts);
      await saveVault({ version: 1, accounts: result.accounts }); return { added: result.added };
    }
    case 'REGISTER': await registerSites(); return null;
    case 'CAPTURE': {
      const key = `capture.${message.token}`;
      const capture = (await chrome.storage.session.get(key))[key];
      await chrome.storage.session.remove(key);
      if (!capture) throw new Error('截图已过期，请重新右键扫描。');
      return capture;
    }
    default: throw new Error('不支持的操作。');
  }
}

// All vault mutations run in the worker, preserving edits from multiple UI tabs.
let queue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message.type !== 'string') return false;
  const isContent = ['REMEMBER_USER', 'GET_CODE'].includes(message.type);
  const isUI = !sender.tab || sender.url?.startsWith(chrome.runtime.getURL('popup.html'));
  if (!isContent && !isUI) return false;
  const run = async () => {
    await ready;
    try { respond({ ok: true, data: await (isContent ? handleContent(message, sender) : handleUI(message)) }); }
    catch (error) {
      // Never log request objects, vaults, passphrases, keys, or parser exceptions.
      const safe = error instanceof Error && /^[\u4e00-\u9fff]/.test(error.message) ? error.message : '操作失败，请检查数据格式、浏览器权限或存储空间。';
      respond({ ok: false, error: safe });
    }
  };
  queue = queue.then(run, run);
  return true;
});
