// 密码学工具：BCrypt(cost=12) 口令散列、RFC 6238 TOTP、随机令牌。
import bcrypt from 'bcryptjs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 12);
}

export function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

// ---- Base32 (RFC 4648)，用于 TOTP 密钥编码 ----
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = str.replace(/=+$/, '').toUpperCase();
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpSecret() {
  return base32Encode(randomBytes(20));
}

// TOTP 实现（HMAC-SHA1, 30s 步长, 6 位），兼容 Google Authenticator
export function totpCode(secret, timeStep = 30, offset = 0) {
  const key = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / timeStep) + offset;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', key).update(buf).digest();
  const off = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[off] & 0x7f) << 24 | hmac[off + 1] << 16 | hmac[off + 2] << 8 | hmac[off + 3]) % 1e6;
  return String(code).padStart(6, '0');
}

export function totpVerify(secret, code, window = 1) {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  for (let i = -window; i <= window; i++) {
    const a = Buffer.from(totpCode(secret, 30, i));
    const b = Buffer.from(String(code));
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }
  return false;
}
