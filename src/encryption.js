import { validateVault } from './model.js';

const ITERATIONS = 600_000;
export const toBase64 = bytes => btoa(Array.from(bytes, x => String.fromCharCode(x)).join(''));
export const fromBase64 = text => Uint8Array.from(atob(text), x => x.charCodeAt(0));

export async function deriveKey(passphrase, salt) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) throw new Error('加密口令至少需要 12 个字符。');
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptVault(vault, key, salt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('local-authenticator:v1') }, key, new TextEncoder().encode(JSON.stringify(vault)));
  return { format: 'local-authenticator', version: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export function validateEnvelope(value) {
  if (!value || value.format !== 'local-authenticator' || value.version !== 1 || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== ITERATIONS || !['salt', 'iv', 'ciphertext'].every(x => typeof value[x] === 'string')) throw new Error('不支持的加密备份格式。');
  if (value.ciphertext.length > 30_000_000 || fromBase64(value.salt).length !== 16 || fromBase64(value.iv).length !== 12 || fromBase64(value.ciphertext).length < 16) throw new Error('加密备份数据无效。');
  return value;
}

export async function decryptVault(envelope, key) {
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(envelope.iv), additionalData: new TextEncoder().encode('local-authenticator:v1') }, key, fromBase64(envelope.ciphertext));
  } catch { throw new Error('口令错误，或加密数据已损坏。'); }
  return validateVault(JSON.parse(new TextDecoder().decode(plaintext)));
}

export async function createBackup(vault, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return encryptVault(vault, await deriveKey(passphrase, salt), salt);
}

export async function openBackup(value, passphrase) {
  const envelope = validateEnvelope(value);
  return decryptVault(envelope, await deriveKey(passphrase, fromBase64(envelope.salt)));
}
