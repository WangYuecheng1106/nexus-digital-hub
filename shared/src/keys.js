// RSA 密钥对管理：auth 服务首次启动时生成 RS256 密钥对并持久化，
// 其余服务与 gateway 只读取公钥校验 JWT，私钥不出 auth 服务（最小权限原则）。
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './db.js';

const KEY_DIR = () => path.join(dataDir(), 'keys');

export function ensureKeys() {
  fs.mkdirSync(KEY_DIR(), { recursive: true });
  const priv = path.join(KEY_DIR(), 'private.pem');
  const pub = path.join(KEY_DIR(), 'public.pem');
  if (!fs.existsSync(priv) || !fs.existsSync(pub)) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    fs.writeFileSync(priv, privateKey, { mode: 0o600 });
    fs.writeFileSync(pub, publicKey);
  }
  return { privateKey: fs.readFileSync(priv, 'utf8'), publicKey: fs.readFileSync(pub, 'utf8') };
}

export function readPublicKey() {
  const pub = path.join(KEY_DIR(), 'public.pem');
  for (let i = 0; i < 50; i++) {
    if (fs.existsSync(pub)) return fs.readFileSync(pub, 'utf8');
    // 公钥由 auth 服务生成，其他服务启动时短暂等待
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  throw new Error('public key not found; start nexus-auth first');
}
