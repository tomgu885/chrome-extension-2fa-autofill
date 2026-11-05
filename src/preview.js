// Isolated visual preview only; excluded from the extension build.
import { validateAccount, mergeAccounts } from './model.js';
import { createBackup, openBackup } from './encryption.js';
let vault = { version: 1, accounts: [
  validateAccount({ issuer: 'GitHub · 演示', username: 'demo@example.com', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', pinned: true, folder: '工作', labels: ['开发'], domains: ['github.com'] }),
  validateAccount({ issuer: 'Cloudflare · 演示', username: 'demo@example.com', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', folder: '工作', labels: ['基础设施'], domains: ['dash.cloudflare.com'] }),
  validateAccount({ issuer: 'Google · 演示', username: 'personal@example.com', secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', folder: '个人', domains: ['accounts.google.com'] }),
] };
let settings = { autofill: true };
globalThis.chrome = {
  runtime: { getURL: x => x, async sendMessage(message) {
    let data = null;
    try {
      switch (message.type) {
        case 'STATE': data = { vault, settings, origins: ['https://github.com/*'] }; break;
        case 'SAVE': { const item = validateAccount(message.account); vault.accounts = [...vault.accounts.filter(x => x.id !== item.id), item]; break; }
        case 'DELETE': vault.accounts = vault.accounts.filter(x => x.id !== message.id); break;
        case 'SETTINGS': settings = { autofill: message.autofill }; break;
        case 'IMPORT': { const result = mergeAccounts(vault.accounts, message.accounts); vault.accounts = result.accounts; data = { added: result.added }; break; }
        case 'BACKUP': data = await createBackup(vault, message.passphrase); break;
        case 'RESTORE': { const restored = await openBackup(message.envelope, message.passphrase); const result = mergeAccounts(vault.accounts, restored.accounts); vault.accounts = result.accounts; data = { added: result.added }; break; }
        default: throw new Error('演示页面不连接 Chrome 扩展 API，请加载 dist 体验完整功能。');
      }
      return { ok: true, data };
    } catch { return { ok: false, error: '这是使用公开测试密钥的演示页面。请加载扩展体验此功能。' }; }
  } },
  tabs: { query: async () => [{ id: 1, url: 'https://github.com/login' }], create: async () => {} },
  permissions: { request: async () => false, remove: async () => true },
};
const banner = document.createElement('div'); banner.textContent = '界面演示 · 仅使用公开测试密钥 · 数据不保存'; banner.style.cssText = 'text-align:center;padding:8px;color:#b9cfbf;font-size:11px'; document.body.prepend(banner);
await import('./popup.js');
