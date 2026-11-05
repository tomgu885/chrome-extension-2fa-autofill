import { validateAccount, normalizeHost } from './model.js';
import { generateTOTP } from './totp.js';
import { parseImport } from './import.js';

const $ = selector => document.querySelector(selector);
/** @returns {NodeListOf<HTMLElement>} */
const $$ = selector => document.querySelectorAll(selector);
let state, currentTab, folder = '', currentView = 'accounts', toastTimer;
let imported = [], batches = new Map();
const codeCache = new Map();
async function request(type, data = {}) {
  const response = await chrome.runtime.sendMessage({ type, ...data });
  if (!response?.ok) throw new Error(response?.error ?? '扩展连接失败，请重新加载。');
  return response.data;
}
function toast(message, error = false) {
  const node = $('#toast'); node.textContent = message; node.className = error ? 'error' : ''; node.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { node.hidden = true; }, error ? 8000 : 3500);
}
function safeError(error) { return error instanceof Error && /^[\u4e00-\u9fff]/.test(error.message) ? error.message : '操作失败，请检查数据、文件格式或浏览器权限。'; }
function action(selector, callback) {
  $(selector).addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try { await callback(); } catch (error) { toast(safeError(error), true); }
    finally { button.disabled = false; }
  });
}
function switchView(view) {
  currentView = view;
  $$('.view').forEach(node => { node.hidden = node.id !== `${view}-view`; });
  $$('nav button').forEach(node => { node.classList.toggle('active', node.dataset.view === view); });
  if (view === 'accounts') void renderAccounts();
}
function element(tag, className, text = '') {
  const node = document.createElement(tag); node.className = className; node.textContent = text; return node;
}
function button(text, className, label, callback) {
  const node = element('button', className, text); node.title = label; node.setAttribute('aria-label', label);
  node.addEventListener('click', () => { Promise.resolve(callback()).catch(error => toast(safeError(error), true)); });
  return node;
}
async function refresh() {
  state = await request('STATE');
  $('#count').textContent = String(state.vault.accounts.length);
  $('#autofill-toggle').checked = state.settings.autofill;
  const folders = [...new Set(state.vault.accounts.map(x => x.folder).filter(Boolean))].sort();
  $('#folder-options').replaceChildren(...folders.map(x => { const option = document.createElement('option'); option.value = x; return option; }));
  if (folder && folder !== '__pinned' && !folders.includes(folder)) folder = '';
  $('#folders').replaceChildren(...[['', '全部'], ['__pinned', '★ 置顶'], ...folders.map(x => [x, x])].map(([value, label]) => {
    const node = button(label, value === folder ? 'selected' : '', label, async () => { folder = value; await refresh(); });
    return node;
  }));
  const permissions = $('#permission-list'); permissions.replaceChildren();
  for (const origin of state.origins) {
    const row = element('div', 'permission'); row.append(element('span', '', origin));
    row.append(button('移除', 'text-button', `移除 ${origin} 授权`, async () => { await chrome.permissions.remove({ origins: [origin] }); await request('REGISTER'); await refresh(); }));
    permissions.append(row);
  }
  if (!state.origins.length) permissions.append(element('p', 'hint', '尚未授权任何网站。'));
  await renderAccounts();
}
async function renderAccounts() {
  if (!state) return;
  const search = $('#search').value.trim().toLowerCase();
  const accounts = state.vault.accounts.filter(x => (!folder || (folder === '__pinned' ? x.pinned : x.folder === folder)) && [x.issuer, x.username, x.folder, ...x.labels, ...x.domains].join(' ').toLowerCase().includes(search)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.issuer.localeCompare(b.issuer));
  $('#empty').hidden = accounts.length > 0;
  $('#empty h3').textContent = state.vault.accounts.length ? '没有匹配的账号' : '让登录更简单';
  $('#empty p').textContent = state.vault.accounts.length ? '试试其他关键词或文件夹。' : '添加你的第一个 TOTP 账号，验证码就会在这里自动更新。';
  const list = $('#account-list'); list.replaceChildren();
  for (const account of accounts) {
    const card = element('article', 'account'); card.dataset.id = account.id;
    const top = element('div', 'account-top'), info = element('div', 'account-info');
    info.append(element('strong', '', account.issuer || 'TOTP 账号'), element('p', '', account.username));
    top.append(element('span', 'avatar', (account.issuer || account.username).slice(0, 1).toUpperCase()), info,
      button(account.pinned ? '★' : '☆', `icon-button pin ${account.pinned ? 'active' : ''}`, account.pinned ? '取消置顶' : '置顶', async () => { await request('SAVE', { account: { ...account, pinned: !account.pinned } }); await refresh(); }));
    const row = element('div', 'code-row');
    const code = button('••• •••', 'code', `复制 ${account.issuer || account.username} 验证码`, async () => { await navigator.clipboard.writeText(await generateTOTP(account)); toast('验证码已复制'); });
    row.append(code, element('span', 'remaining'));
    card.append(top, row, element('span', 'copy-hint', '点击验证码复制'));
    const tags = element('div', 'tags');
    [account.folder, ...account.labels].filter(Boolean).forEach(label => tags.append(element('span', 'tag', label)));
    card.append(tags);
    const actions = element('div', 'account-actions');
    actions.append(button('编辑', '', `编辑 ${account.issuer || account.username}`, () => openEditor(account)), button('删除', 'danger', `删除 ${account.issuer || account.username}`, async () => {
      if (!confirm('删除此账号？请确认你已保留密钥或备份。')) return;
      await request('DELETE', { id: account.id }); codeCache.delete(account.id); await refresh(); toast('账号已删除');
    }));
    const progress = element('div', 'progress'); progress.append(element('div', ''));
    card.append(actions, progress); list.append(card);
  }
  await tick();
}
async function tick() {
  if (!state || currentView !== 'accounts') return;
  for (const card of $$('.account')) {
    const account = state.vault.accounts.find(x => x.id === card.dataset.id);
    if (!account) continue;
    const period = Math.floor(Date.now() / 1000 / account.period);
    let cached = codeCache.get(account.id);
    if (!cached || cached.period !== period || cached.secret !== account.secret || cached.algorithm !== account.algorithm || cached.digits !== account.digits) {
      cached = { period, secret: account.secret, algorithm: account.algorithm, digits: account.digits, code: await generateTOTP(account) }; codeCache.set(account.id, cached);
    }
    const seconds = account.period - Math.floor(Date.now() / 1000) % account.period;
    card.querySelector('.code').textContent = cached.code.slice(0, cached.code.length / 2) + ' ' + cached.code.slice(cached.code.length / 2);
    card.querySelector('.remaining').textContent = `${seconds}s`;
    /** @type {HTMLElement} */ (card.querySelector('.progress div')).style.width = `${seconds / account.period * 100}%`;
  }
}
function openEditor(account = null) {
  const form = $('#account-form'); form.reset(); $('#editor-error').textContent = '';
  $('#editor-title').textContent = account ? '编辑账号' : '添加账号';
  if (account) for (const [key, value] of Object.entries(account)) {
    const input = form.elements.namedItem(key);
    if (!input) continue;
    if (input.type === 'checkbox') input.checked = value === true;
    else input.value = Array.isArray(value) ? value.join(', ') : String(value);
  }
  $('#account-dialog').showModal();
}
$('#account-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type=submit]'); submit.disabled = true;
  try {
    const account = validateAccount({ ...data, domains: String(data.domains).split(/[,，]/).filter(x => x.trim()), labels: String(data.labels).split(/[,，]/).filter(x => x.trim()), pinned: data.pinned === 'on', allowWithoutUsername: data.allowWithoutUsername === 'on' });
    await request('SAVE', { account }); $('#account-dialog').close(); form.reset(); await refresh(); toast('账号已保存');
  } catch (error) { $('#editor-error').textContent = safeError(error); }
  finally { submit.disabled = false; }
});
$('#account-dialog').addEventListener('close', () => { $('#account-form').reset(); });

function acceptImport(text) {
  const parsed = parseImport(text);
  if (parsed.batch) {
    const key = String(parsed.batch.id);
    let batch = batches.get(key);
    if (!batch) { batch = { size: parsed.batch.size, parts: new Map() }; batches.set(key, batch); }
    if (batch.size !== parsed.batch.size) throw new Error('迁移批次信息不一致，请清空后重新导入。');
    batch.parts.set(parsed.batch.index, parsed.accounts);
  } else imported.push(...parsed.accounts);
}
function pendingAccounts() { return [...imported, ...[...batches.values()].flatMap(b => [...b.parts.values()].flat())]; }
function renderImport() {
  const accounts = pendingAccounts(); $('#import-preview').hidden = !accounts.length;
  $('#import-accounts').replaceChildren(...accounts.map(x => { const row = element('li', '', x.issuer || 'TOTP 账号'); row.append(element('span', '', x.username)); return row; }));
  $('#batch-status').textContent = [...batches.values()].map(b => `Google 迁移：已读取 ${b.parts.size} / ${b.size} 份链接`).join('；') || `已读取 ${accounts.length} 个账号`;
  $('#confirm-import').disabled = [...batches.values()].some(b => b.parts.size !== b.size);
}
function clearImport() { imported = []; batches = new Map(); $('#import-text').value = ''; renderImport(); }
$$('nav button').forEach(node => node.addEventListener('click', () => switchView(node.dataset.view)));
$$('[data-go]').forEach(node => node.addEventListener('click', () => switchView(node.dataset.go)));
$('#add-account').addEventListener('click', () => openEditor());
$('#empty-add').addEventListener('click', () => openEditor());
$('#close-editor').addEventListener('click', () => $('#account-dialog').close());
$('#search').addEventListener('input', () => { void renderAccounts(); });
document.addEventListener('keydown', event => { if (event.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !$('#account-dialog').open) { event.preventDefault(); switchView('accounts'); $('#search').focus(); } });
action('#expand', () => chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }));
action('#parse-import', async () => { acceptImport($('#import-text').value); $('#import-text').value = ''; renderImport(); });
action('#clear-import', async () => clearImport());
action('#confirm-import', async () => {
  if ([...batches.values()].some(b => b.parts.size !== b.size)) throw new Error('请先添加此批次的全部迁移链接。');
  const domains = $('#import-domains').value.split(/[,，]/).map(x => x.trim()).filter(Boolean).map(normalizeHost);
  const accounts = pendingAccounts().map(x => ({ ...x, folder: $('#import-folder').value.trim(), domains }));
  const result = await request('IMPORT', { accounts }); clearImport(); await refresh(); switchView('accounts'); toast(`已导入 ${result.added} 个账号，重复项已跳过`);
});
action('#export-backup', async () => {
  const passphrase = $('#backup-passphrase').value;
  if (passphrase !== $('#backup-confirm').value) throw new Error('两次输入的口令不一致。');
  const envelope = await request('BACKUP', { passphrase });
  const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `authenticator-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  $('#backup-passphrase').value = ''; $('#backup-confirm').value = ''; toast('加密备份已导出');
});
action('#restore-backup', async () => {
  const file = $('#backup-file').files[0];
  if (!file || file.size > 30_000_000) throw new Error('请选择不超过 30 MB 的加密备份文件。');
  const result = await request('RESTORE', { envelope: JSON.parse(await file.text()), passphrase: $('#restore-passphrase').value });
  $('#restore-passphrase').value = ''; $('#backup-file').value = ''; await refresh(); toast(`已恢复 ${result.added} 个账号`);
});
$('#autofill-toggle').addEventListener('change', async event => { try { await request('SETTINGS', { autofill: event.target.checked }); await refresh(); } catch (error) { toast(safeError(error), true); } });
action('#enable-site', async () => {
  if (!currentTab?.url) return;
  const url = new URL(currentTab.url), origin = `${url.protocol}//${url.hostname}/*`;
  // permissions.request is called directly in the click gesture, before any await.
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) { toast('未授权此网站'); return; }
  await request('REGISTER');
  await chrome.scripting.executeScript({ target: { tabId: currentTab.id, allFrames: true }, files: ['content.js'] });
  await refresh(); toast('已启用，请在账号中配置此主机名');
});

async function init() {
  await refresh();
  [currentTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (currentTab?.url && /^https?:/.test(currentTab.url)) {
    const url = new URL(currentTab.url); $('#current-site').textContent = url.hostname; $('#enable-site').disabled = false;
  }
  setInterval(() => { tick().catch(() => {}); }, 1000);
}
init().catch(error => toast(safeError(error), true));
