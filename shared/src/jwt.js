// JWT 签发/校验：RS256 非对称签名。access token 30 分钟短效，refresh token 7 天长效。
import jwt from 'jsonwebtoken';
import { ensureKeys, readPublicKey } from './keys.js';

const ISSUER = 'nexus-auth';
const AUDIENCE = 'nexus-platform';
let pubCache = null;

export function signAccessToken(user) {
  const { privateKey } = ensureKeys();
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      name: user.display_name,
      roles: user.roles || [],
      perms: user.perms || [],
      scope: user.scope || 'self',
      dept: user.dept_id || null,
    },
    privateKey,
    { algorithm: 'RS256', expiresIn: '30m', issuer: ISSUER, audience: AUDIENCE }
  );
}

export function signRefreshToken(userId, jti) {
  const { privateKey } = ensureKeys();
  return jwt.sign({ sub: String(userId), jti, typ: 'refresh' }, privateKey, {
    algorithm: 'RS256',
    expiresIn: '7d',
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

export function verifyToken(token) {
  if (!pubCache) pubCache = readPublicKey();
  return jwt.verify(token, pubCache, { algorithms: ['RS256'], issuer: ISSUER, audience: AUDIENCE });
}
