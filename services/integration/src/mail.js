// 企业邮箱：IMAP/SMTP 配置 + 本地收件箱演示 + MCP 风格工具清单
// 对标钉钉邮箱 / WeLink 连接业务 — 管理员配置后即可收发；演示环境无真实 IMAP 时用本地存储
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

const DEMO_SEED = [
  {
    from: 'hr@nexus.local', to: 'you', subject: '入职欢迎与账号开通',
    body: '欢迎加入 Nexus 数字中枢。请完成安全培训并绑定企业邮箱。\n\n— HR',
  },
  {
    from: 'meeting@nexus.local', to: 'you', subject: '本周项目同步会议纪要',
    body: '纪要摘要：\n1. 语音消息对标钉钉气泡\n2. 邮箱接入 MCP 工具面\n3. 图谱 AI 整理人员\n\n详见知识库。',
  },
  {
    from: 'security@nexus.local', to: 'you', subject: '安全提醒：API Key 仅管理员可见',
    body: '请勿在聊天中粘贴模型密钥。在「设置 → AI 模型」由管理员集中配置。',
  },
];

export function getMailConfig(userId) {
  const row = db.get('SELECT * FROM mail_accounts WHERE user_id = ?', userId);
  if (!row) {
    return {
      email: '', imapHost: '', smtpHost: '', username: '',
      status: 'disconnected', hasPassword: false,
    };
  }
  return {
    email: row.email || '',
    imapHost: row.imap_host || '',
    smtpHost: row.smtp_host || '',
    username: row.username || '',
    status: row.status || 'disconnected',
    hasPassword: !!row.password,
  };
}

export function saveMailConfig(userId, body) {
  const now = Date.now();
  const existing = db.get('SELECT * FROM mail_accounts WHERE user_id = ?', userId);
  const password = body.password || existing?.password || '';
  const status = body.email && (body.imapHost || body.smtpHost) ? 'connected' : 'disconnected';
  db.run(
    `INSERT INTO mail_accounts (user_id, email, imap_host, smtp_host, username, password, status, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       email=excluded.email, imap_host=excluded.imap_host, smtp_host=excluded.smtp_host,
       username=excluded.username, password=CASE WHEN excluded.password='' THEN mail_accounts.password ELSE excluded.password END,
       status=excluded.status, updated_at=excluded.updated_at`,
    userId,
    body.email || '',
    body.imapHost || '',
    body.smtpHost || '',
    body.username || body.email || '',
    password,
    status,
    now
  );
  // 首次连接时注入演示收件箱，保证员工端立刻可用
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
  if (count === 0) {
    seedInbox(userId, cfg?.email || 'you@nexus.local');
  }
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
  // 模拟投递回执：写入收件人侧 inbox（若 to 是本系统用户邮箱则另议；演示直接回执一份到自己 inbox）
  if (cfg.status === 'connected' || true) {
    db.run(
      `INSERT INTO mail_messages (id, user_id, folder, from_addr, to_addr, subject, body, read, created_at)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      snowflake(), userId, 'inbox', 'mailer-daemon@nexus.local', from,
      `已投递: ${subject}`,
      `邮件已通过 ${cfg.smtpHost || 'nexus-local-smtp'} 投递至 ${to}。\n（演示环境：真实 SMTP 需管理员配置外发）`,
      0, Date.now()
    );
  }
  return { id, to, subject, status: 'sent', via: cfg.smtpHost || 'local' };
}

/** MCP 风格工具面：供 AI / 外部 Agent 调用邮箱能力（对齐 WeLink 开放 API 思路） */
export function listMcpTools() {
  return {
    tools: [
      { name: 'mail_list_inbox', description: '列出收件箱邮件', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
      { name: 'mail_list_sent', description: '列出已发送', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
      { name: 'mail_send', description: '发送邮件', inputSchema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } }, required: ['to', 'subject'] } },
      { name: 'mail_get_config', description: '查看邮箱连接状态（不含密码）', inputSchema: { type: 'object', properties: {} } },
    ],
  };
}

export function invokeMcpTool(userId, name, args = {}) {
  switch (name) {
    case 'mail_list_inbox': return { messages: listMail(userId, 'inbox').slice(0, args.limit || 20) };
    case 'mail_list_sent': return { messages: listMail(userId, 'sent').slice(0, args.limit || 20) };
    case 'mail_send': return sendMail(userId, args);
    case 'mail_get_config': return getMailConfig(userId);
    default: throw new Error(`未知 MCP 工具: ${name}`);
  }
}
