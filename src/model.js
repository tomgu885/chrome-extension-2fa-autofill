/** @typedef {{id:string, issuer:string, username:string, secret:string, algorithm:string, digits:number, period:number, domains:string[], folder:string, labels:string[], pinned:boolean, allowWithoutUsername:boolean}} Account */
export const EMPTY_VAULT = { version: 1, accounts: [] };

export function normalizeHost(value) {
  const text = value.trim().toLowerCase();
  if (!text) return '';
  const url = new URL(text.includes('://') ? text : `https://${text}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || url.hostname.includes('*')) {
    throw new Error('网站请填写完整主机名，不含路径、端口或通配符。');
  }
  return url.hostname;
}

export function decodeBase32(value) {
  const input = value.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!/^[A-Z2-7]+$/.test(input) || ![0, 2, 4, 5, 7].includes(input.length % 8)) throw new Error('密钥不是有效的 Base32。');
  let bits = 0, buffer = 0;
  const bytes = [];
  for (const char of input) {
    buffer = (buffer << 5) | 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(char);
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((buffer >>> bits) & 255); }
  }
  if (!bytes.length || (buffer & ((1 << bits) - 1))) throw new Error('密钥不是有效的 Base32。');
  return new Uint8Array(bytes);
}

export function encodeBase32(bytes) {
  let bits = 0, buffer = 0, out = '';
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(buffer >>> bits) & 31]; }
  }
  if (bits) out += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'[(buffer << (5 - bits)) & 31];
  return out;
}

/** Validate only at input boundaries. @returns {Account} */
export function validateAccount(value) {
  if (!value || typeof value !== 'object' || typeof value.secret !== 'string' || typeof value.username !== 'string') throw new Error('账号数据格式无效。');
  const secret = value.secret.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  decodeBase32(secret);
  const algorithm = String(value.algorithm ?? 'SHA1').toUpperCase().replace('-', '');
  const digits = Number(value.digits ?? 6), period = Number(value.period ?? 30);
  if (!['SHA1', 'SHA256', 'SHA512'].includes(algorithm) || ![6, 8].includes(digits) || !Number.isInteger(period) || period < 5 || period > 300) throw new Error('仅支持 SHA1/256/512、6/8 位、5–300 秒周期的 TOTP。');
  if (!value.username.trim() || value.username.length > 500 || String(value.issuer ?? '').length > 500) throw new Error('请填写有效的账号名称。');
  if (value.domains !== undefined && (!Array.isArray(value.domains) || value.domains.some(x => typeof x !== 'string'))) throw new Error('网站列表格式无效。');
  if (value.labels !== undefined && (!Array.isArray(value.labels) || value.labels.some(x => typeof x !== 'string'))) throw new Error('标签格式无效。');
  return {
    id: typeof value.id === 'string' && value.id ? value.id : crypto.randomUUID(),
    issuer: String(value.issuer ?? '').trim(), username: value.username.trim(), secret,
    algorithm, digits, period, domains: [...new Set((value.domains ?? []).map(normalizeHost).filter(Boolean))],
    folder: String(value.folder ?? '').trim(), labels: [...new Set((value.labels ?? []).map(x => x.trim()).filter(Boolean))],
    pinned: value.pinned === true, allowWithoutUsername: value.allowWithoutUsername === true,
  };
}

export function validateVault(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.accounts)) throw new Error('不支持的账号库版本。');
  const accounts = value.accounts.map(validateAccount);
  if (new Set(accounts.map(x => x.id)).size !== accounts.length) throw new Error('账号库包含重复标识。');
  return { version: 1, accounts };
}

export function mergeAccounts(existing, incoming) {
  const result = [...existing];
  let added = 0;
  for (const account of incoming) {
    if (!result.some(x => x.secret === account.secret && x.username.toLowerCase() === account.username.toLowerCase() && x.algorithm === account.algorithm && x.digits === account.digits && x.period === account.period)) {
      result.push({ ...account, id: crypto.randomUUID() }); added++;
    }
  }
  return { accounts: result, added };
}

export function matchAccount(accounts, hostname, usernames) {
  const site = accounts.filter(x => x.domains.includes(hostname));
  const names = usernames.map(x => x.trim().toLowerCase()).filter(Boolean);
  const candidates = names.length ? site.filter(x => names.includes(x.username.toLowerCase())) : site.filter(x => x.allowWithoutUsername);
  return candidates.length === 1 ? candidates[0] : null;
}
