import { decodeBase32 } from './model.js';

export async function generateTOTP(account, time = Date.now()) {
  const counter = BigInt(Math.floor(time / 1000 / account.period));
  const message = new Uint8Array(8);
  new DataView(message.buffer).setBigUint64(0, counter);
  const key = await crypto.subtle.importKey('raw', decodeBase32(account.secret), { name: 'HMAC', hash: account.algorithm.replace('SHA', 'SHA-') }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  const offset = digest[digest.length - 1] & 15;
  const binary = new DataView(digest.buffer).getUint32(offset) & 0x7fffffff;
  return String(binary % 10 ** account.digits).padStart(account.digits, '0');
}
