import { encodeBase32, validateAccount } from './model.js';

export function parseOTPAuth(text) {
  const url = new URL(text.trim());
  if (url.protocol !== 'otpauth:' || url.hostname !== 'totp') throw new Error('仅支持 otpauth://totp 账号；不支持 HOTP。');
  const label = decodeURIComponent(url.pathname.slice(1));
  const separator = label.indexOf(':');
  return validateAccount({
    issuer: url.searchParams.get('issuer') ?? (separator < 0 ? '' : label.slice(0, separator)),
    username: separator < 0 ? label : label.slice(separator + 1).trim(), secret: url.searchParams.get('secret'),
    algorithm: url.searchParams.get('algorithm') ?? 'SHA1', digits: url.searchParams.get('digits') ?? 6,
    period: url.searchParams.get('period') ?? 30,
  });
}

// Google Authenticator's export is a protobuf MigrationPayload. Unknown fields
// are skipped by wire type so imports remain compatible with added metadata.
function protobuf(bytes) {
  let pos = 0;
  const fields = new Map();
  function varint() {
    let value = 0n, shift = 0n;
    for (let i = 0; i < 10; i++) {
      if (pos >= bytes.length) throw new Error('迁移链接数据不完整。');
      const byte = bytes[pos++]; value |= BigInt(byte & 127) << shift;
      if (!(byte & 128)) return value;
      shift += 7n;
    }
    throw new Error('迁移链接格式无效。');
  }
  while (pos < bytes.length) {
    const tag = Number(varint()), field = tag >>> 3, wire = tag & 7;
    if (!field) throw new Error('迁移链接格式无效。');
    let value;
    if (wire === 0) value = Number(BigInt.asIntN(32, varint()));
    else if (wire === 2) {
      const length = Number(varint());
      if (length > bytes.length - pos) throw new Error('迁移链接数据不完整。');
      value = bytes.slice(pos, pos + length); pos += length;
    } else if (wire === 1 || wire === 5) {
      pos += wire === 1 ? 8 : 4;
      if (pos > bytes.length) throw new Error('迁移链接数据不完整。');
      continue;
    } else throw new Error('迁移链接格式无效。');
    fields.set(field, [...(fields.get(field) ?? []), value]);
  }
  return fields;
}

export function parseMigration(text) {
  const url = new URL(text.trim());
  if (url.protocol !== 'otpauth-migration:' || url.hostname !== 'offline') throw new Error('迁移链接格式无效。');
  const data = url.searchParams.get('data');
  if (!data || data.length > 2_000_000) throw new Error('迁移链接格式无效。');
  const payload = protobuf(Uint8Array.from(atob(data.replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
  const get = (map, key, fallback) => map.get(key)?.[0] ?? fallback;
  if (get(payload, 2, 1) !== 1) throw new Error('不支持此 Google Authenticator 迁移版本。');
  const accounts = (payload.get(1) ?? []).map(bytes => {
    const item = protobuf(bytes);
    if (get(item, 6, 0) !== 2) throw new Error('迁移中含有非 TOTP 账号，尚未导入任何账号。');
    const algorithm = { 1: 'SHA1', 2: 'SHA256', 3: 'SHA512' }[get(item, 4, 0)];
    const digits = { 1: 6, 2: 8 }[get(item, 5, 0)];
    if (!algorithm || !digits) throw new Error('迁移账号使用了不支持的算法或位数。');
    const decode = key => new TextDecoder('utf-8', { fatal: true }).decode(get(item, key, new Uint8Array()));
    const issuer = decode(3), name = decode(2);
    return validateAccount({ issuer, username: issuer && name.startsWith(`${issuer}:`) ? name.slice(issuer.length + 1).trim() : name, secret: encodeBase32(get(item, 1, new Uint8Array())), algorithm, digits });
  });
  const batch = { id: get(payload, 5, 0), size: get(payload, 3, 1), index: get(payload, 4, 0) };
  if (!accounts.length || !Number.isInteger(batch.size) || batch.size < 1 || batch.size > 1000 || batch.index < 0 || batch.index >= batch.size) throw new Error('迁移批次信息无效。');
  return { accounts, batch };
}

export function parseImport(text) {
  if (text.trim().startsWith('otpauth-migration:')) return parseMigration(text);
  const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (!lines.length) throw new Error('请提供 TOTP 设置链接。');
  return { accounts: lines.map(parseOTPAuth), batch: null };
}
