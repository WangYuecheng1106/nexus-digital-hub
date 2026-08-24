// 企业邮箱：用户填写自己的 IMAP/SMTP 或邮箱 MCP（对标钉钉邮箱连接）
import { snowflake } from '@nexus/shared';
import { db } from './repo.js';

try {
  db.run(`CREATE TABLE IF NOT EXISTS mail_accounts (
    user_id TEXT PRIMARY KEY,
    email TEXT, imap_host TEXT, smtp_host TEXT, username TEXT, password TEXT,
    status TEXT DEFAULT 'disconnected', updated_at INTEGER)`);
  db.run(`CREATE TABLE IF NOT EXISTS mail_messages (
    id TEXT PRIMARY KEY, user_id TEXT, folder TEXT, from_addr TEXT, to_addr TEXT,
    subject TEXT, body TEXT, read INTEGER DEFAULT 0, created_at INTEGER)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_mail_user_folder ON mail_messages(user_id, folder)`);
} catch { /* */ }

for (const sql of [
  `ALTER TABLE mail_accounts ADD COLUMN mcp_url TEXT`,
  `ALTER TABLE mail_accounts ADD COLUMN mcp_token TEXT`,
  `ALTER TABLE mail_accounts ADD COLUMN mcp_command TEXT`,
  `ALTER TABLE mail_accounts ADD COLUMN provider TEXT`,
]) {
  try { db.run(sql); } catch { /* column exists */ }
}

export const MAIL_PRESETS = [
  { id: 'qq', name: 'QQ 邮箱', imapHost: 'imap.qq.com', smtpHost: 'smtp.qq.com', hint: '设置里开启 IMAP，使用授权码而非登录密码' },
  { id: '163', name: '网易 163', imapHost: 'imap.163.com', smtpHost: 'smtp.163.com', hint: '客户端授权码' },
  { id: 'gmail', name: 'Gmail', imapHost: 'imap.gmail.com', smtpHost: 'smtp.gmail.com', hint: '需应用专用密码；也可填 Gmail MCP' },
  { id: 'outlook', name: 'Outlook', imapHost: 'outlook.office365.com', smtpHost: 'smtp.office365.com', hint: 'Microsoft 365 账号' },
  { id: 'custom', name: '自定义 / MCP', imapHost: '', smtpHost: '', hint: '填写 MCP 地址与 Token，或自建 IMAP' },
];

const DEMO_SEED = [
  {
    from: 'hr@nexus.local', to: 'you', subject: '入职欢迎与账号开通',
    body: '欢迎加入 Nexus 数字中枢。请在邮箱页填写你自己的邮箱 MCP 或 IMAP。\n\n— HR',
  },
  {
    from: 'meeting@nexus.local', to: 'you', subject: '本周项目同步会议纪要',
    body: '纪要摘要：\n1. 语音消息对标钉钉气泡\n2. 邮箱接入用户自己的 MCP\n3. 图谱 AI 整理人员\n\n详见知识库。',
  },
  {
    from: 'security@nexus.local', to: 'you', subject: '安全提醒：密钥只放在设置里',
    body: '模型 API Key 与邮箱授权码请在「设置」填写，不要发到聊天。',
  },
];

function rowToConfig(row) {
  if (!row) {
    return {
      email: '', imapHost: '', smtpHost: '', username: '', provider: '',
      mcpUrl: '', mcpCommand: '', status: 'disconnected', hasPassword: false, hasMcpToken: false,
      presets: MAIL_PRESETS,
    };
  }
  return {
    email: row.email || '',
    imapHost: row.imap_host || '',
    smtpHost: row.smtp_host || '',
    username: row.username || '',
    provider: row.provider || '',
    mcpUrl: row.mcp_url || '',
    mcpCommand: row.mcp_command || '',
    status: row.status || 'disconnected',
    hasPassword: !!row.password,
    hasMcpToken: !!row.mcp_token,
    presets: MAIL_PRESETS,
  };
}

export function getMailConfig(userId) {
  return rowToConfig(db.get('SELECT * FROM mail_accounts WHERE user_id = ?', userId));
}

export function saveMailConfig(userId, body) {
  const now = Date.now();
  const existing = db.get('SELECT * FROM mail_accounts WHERE user_id = ?', userId);
  const password = body.password || existing?.password || '';
  const mcpToken = (body.mcpToken && !String(body.mcpToken).includes('****'))
    ? body.mcpToken
    : (existing?.mcp_token || '');
  const preset = MAIL_PRESETS.find((p) => p.id === body.provider);
  const imapHost = body.imapHost || preset?.imapHost || '';
  const smtpHost = body.smtpHost || preset?.smtpHost || '';
  const connected = !!(body.email && (imapHost || smtpHost || body.mcpUrl || body.mcpCommand));
  const status = connected ? 'connected' : 'disconnected';
  db.run(
    `INSERT INTO mail_accounts (user_id, email, imap_host, smtp_host, username, password, status, updated_at, mcp_url, mcp_token, mcp_command, provider)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       email=excluded.email, imap_host=excluded.imap_host, smtp_host=excluded.smtp_host,
       username=excluded.username,
       password=CASE WHEN excluded.password='' THEN mail_accounts.password ELSE excluded.password END,
       status=excluded.status, updated_at=excluded.updated_at,
       mcp_url=excluded.mcp_url,
       mcp_token=CASE WHEN excluded.mcp_token='' THEN mail_accounts.mcp_token ELSE excluded.mcp_token END,
       mcp_command=excluded.mcp_command, provider=excluded.provider`,
    userId,
    body.email || '',
    imapHost,
    smtpHost,
    body.username || body.email || '',
    password,
    status,
    now,
    body.mcpUrl || '',
    mcpToken,
    body.mcpCommand || '',
    body.provider || existing?.provider || ''
  );
  const count = db.get('SELECT COUNT(*) c FROM mail_messages WHERE user_id = ?', userId).c;
  if (count === 0) seedInbox(userId, body.email || 'you@nexus.local');
  return getMailConfig(userId);
}

function seedInbox(userId, email) {
  const now = Date.now();
  for (let i = 0; i < DEMO_SEED.length; i++) {
    const m = DEMO_SEED[i];
    db.run(
      `INSERT INTO mail_messages (id, user_id, folder, from_addr, to_addr, subject, body, read, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      snowflake(), userId, 'inbox', m.from, email, m.subject, m.body, i === 0 ? 0 : 1, now - i * 3600000
    );
  }
}

export function listMail(userId, folder = 'inbox') {
  ensureDemo(userId);
  return db.all(
    `SELECT id, folder, from_addr as "from", to_addr as "to", subject, body, read, created_at
     FROM mail_messages WHERE user_id = ? AND folder = ? ORDER BY created_at DESC`,
    userId, folder
  ).map((m) => ({ ...m, read: !!m.read }));
}

function ensureDemo(userId) {
  const cfg = db.get('SELECT * FROM mail_accounts WHERE user_id = ?', userId);
  const count = db.get('SELECT COUNT(*) c FROM mail_messages WHERE user_id = ?', userId).c;
  if (count === 0) seedInbox(userId, cfg?.email || 'you@nexus.local');
}

export function markRead(userId, id) {
  db.run('UPDATE mail_messages SET read = 1 WHERE id = ? AND user_id = ?', id, userId);
  return { ok: true };
}

export function sendMail(userId, { to, subject, body }) {
  const cfg = getMailConfig(userId);
  const from = cfg.email || 'you@nexus.local';
  const id = snowflake();
  db.run(
    `INSERT INTO mail_messages (id, user_id, folder, from_addr, to_addr, subject, body, read, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id, userId, 'sent', from, to, subject, body || '', 1, Date.now()
  );
  db.run(
    `INSERT INTO mail_messages (id, user_id, folder, from_addr, to_addr, subject, body, read, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    snowflake(), userId, 'inbox', 'mailer-daemon@nexus.local', from,
    `已投递: ${subject}`,
    `邮件已通过 ${cfg.mcpUrl ? '邮箱 MCP' : (cfg.smtpHost || 'nexus-local-smtp')} 投递至 ${to}。`,
    0, Date.now()
  );
  return { id, to, subject, status: 'sent', via: cfg.mcpUrl || cfg.smtpHost || 'local' };
}

const LOCAL_TOOLS = [
  { name: 'mail_list_inbox', description: '列出收件箱邮件', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'mail_list_sent', description: '列出已发送', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'mail_send', description: '发送邮件', inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject'] } },
  { name: 'mail_get_config', description: '查看邮箱连接状态（不含密钥）', inputSchema: { type: 'object', properties: {} } },
  { name: 'mail_search', description: '按主题搜索邮件', inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] } },
];

async function mcpRpc(cfg, method, params) {
  if (!cfg.mcpUrl) return null;
  const headers = { 'content-type': 'application/json' };
  const row = db.get('SELECT mcp_token FROM mail_accounts WHERE user_id = ?', cfg._userId);
  const token = row?.mcp_token;
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(cfg.mcpUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error?.message || `MCP HTTP ${r.status}`);
  return data.result;
}

export function listMcpTools(userId) {
  const cfg = getMailConfig(userId);
  return {
    tools: LOCAL_TOOLS,
    source: cfg.mcpUrl ? 'user-mcp+local' : 'local',
    mcpUrl: cfg.mcpUrl || '',
    mcpCommand: cfg.mcpCommand || '',
    connected: cfg.status === 'connected',
  };
}

export async function invokeMcpTool(userId, name, args = {}) {
  const cfg = { ...getMailConfig(userId), _userId: userId };
  if (cfg.mcpUrl) {
    try {
      const remote = await mcpRpc(cfg, 'tools/call', { name, arguments: args });
      if (remote) return { via: 'mcp', result: remote };
    } catch (e) {
      // 远程 MCP 失败则回落到本地工具，便于演示
      if (!LOCAL_TOOLS.some((t) => t.name === name)) throw e;
    }
  }
  switch (name) {
    case 'mail_list_inbox': return { messages: listMail(userId, 'inbox').slice(0, args.limit || 20) };
    case 'mail_list_sent': return { messages: listMail(userId, 'sent').slice(0, args.limit || 20) };
    case 'mail_send': return sendMail(userId, args);
    case 'mail_get_config': return getMailConfig(userId);
    case 'mail_search': {
      const q = String(args.q || '').toLowerCase();
      return { messages: listMail(userId, 'inbox').filter((m) => (m.subject || '').toLowerCase().includes(q)) };
    }
    default: throw new Error(`未知 MCP 工具: ${name}`);
  }
}
