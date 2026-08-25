// nexus-dingtalk：钉钉 H5 微应用对接。
// 职责：
//   1. 免登（前后端分离）：前端拿到 authCode → 本服务换 userId/用户信息
//   2. 通讯录同步：把企业部门树 + 员工写入 knowledge 图谱（/graph/import-org）
// 配置来源（优先级 环境变量 > ./data/dingtalk-config.json > 未配置）：
//   DINGTALK_APP_KEY / DINGTALK_APP_SECRET / DINGTALK_CORP_ID / DINGTALK_AGENT_ID
import { createService, asyncRoute, badRequest, signAccessToken } from '@nexus/shared';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const CONFIG_FILE = path.join(DATA_DIR, 'dingtalk-config.json');

const OAPI = 'https://oapi.dingtalk.com';
const V1 = 'https://api.dingtalk.com/v1.0';

function readConfig() {
  const file = {};
  try { Object.assign(file, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))); } catch { /* */ }
  return {
    appKey: process.env.DINGTALK_APP_KEY || file.appKey || '',
    appSecret: process.env.DINGTALK_APP_SECRET || file.appSecret || '',
    corpId: process.env.DINGTALK_CORP_ID || file.corpId || '',
    agentId: process.env.DINGTALK_AGENT_ID || file.agentId || '',
  };
}

function isConfigured(cfg) {
  return !!(cfg.appKey && cfg.appSecret && cfg.corpId);
}

// 服务端 access_token：企业内部应用用 appKey/appSecret 换取
let tokenCache = { token: '', expireAt: 0 };
async function getAccessToken() {
  const cfg = readConfig();
  if (!isConfigured(cfg)) throw badRequest('钉钉未配置（应用 Key / Secret / CorpId 缺失）');
  if (tokenCache.token && Date.now() < tokenCache.expireAt - 60000) return tokenCache.token;
  const r = await fetch(`${OAPI}/gettoken?appkey=${encodeURIComponent(cfg.appKey)}&appsecret=${encodeURIComponent(cfg.appSecret)}`, {
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(`获取钉钉 access_token 失败: ${JSON.stringify(data)}`);
  tokenCache = { token: data.access_token, expireAt: Date.now() + data.expires_in * 1000 || Date.now() + 7200000 };
  return data.access_token;
}

// 免登：authCode → 用户 userId（topapi/v2/user/getuserinfo）
async function getUserIdByCode(authCode, accessToken) {
  const r = await fetch(`${OAPI}/topapi/v2/user/getuserinfo?access_token=${accessToken}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: authCode }),
    signal: AbortSignal.timeout(8000),
  });
  const data = await r.json();
  if (data.errcode !== 0 || !data.result?.userid) throw new Error(`免登换取用户失败: ${JSON.stringify(data)}`);
  return data.result;
}

// 拉取部门树（BFS：listsub 逐级拿子部门）
async function fetchDepartments(accessToken) {
  const out = [];
  const seen = new Set();
  const queue = [1]; // 钉钉根部门 dept_id=1
  while (queue.length) {
    const parentId = queue.shift();
    if (seen.has(parentId)) continue;
    seen.add(parentId);
    const r = await fetch(`${OAPI}/topapi/v2/department/listsub?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dept_id: parentId }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    if (data.errcode !== 0) continue;
    for (const d of data.result || []) {
      out.push({ id: d.dept_id, name: d.name, parent_id: parentId });
      if (!seen.has(d.dept_id)) queue.push(d.dept_id);
    }
  }
  // 确保根节点也在列表里
  if (!out.some((d) => d.id === 1)) out.unshift({ id: 1, name: '企业根组织', parent_id: null });
  return out;
}

// 拉取员工：逐部门按 user/list 分页
async function fetchEmployees(accessToken, deptId, seenEmp = new Set()) {
  const out = [];
  let cursor = 0;
  for (;;) {
    const r = await fetch(`${OAPI}/topapi/v2/user/list?access_token=${accessToken}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dept_id: deptId, cursor, size: 100 }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json();
    if (data.errcode !== 0) break;
    const list = (data.result?.list || []).filter((u) => !seenEmp.has(u.userid));
    for (const u of list) {
      seenEmp.add(u.userid);
      out.push({
        userid: u.userid,
        name: u.name || '未知',
        title: u.title || u.position || '',
        phone: u.mobile || '',
        email: u.email || '',
        dept_id: u.dept_id_list?.[0] ?? deptId,
      });
    }
    if (!data.result?.has_more) break;
    cursor = data.result.next_cursor || cursor + list.length;
  }
  return out;
}

const { ctx, app } = createService({
  name: 'dingtalk',
  port: 8099,
  publicPaths: ['/health', '/config', '/status', '/auth/*', '/sync/*'],
  setup(app, ctx) {
    // ---- 配置：读取 / 保存（保存写 data/dingtalk-config.json，环境变量优先）----
    app.get('/config', (req, res) => {
      const cfg = readConfig();
      res.json({ configured: isConfigured(cfg), hasKey: !!cfg.appKey, corpId: cfg.corpId, agentId: cfg.agentId });
    });

    app.post('/config', asyncRoute(async (req, res) => {
      const { appKey, appSecret, corpId, agentId } = req.body || {};
      if (!appKey || !appSecret || !corpId) throw badRequest('appKey / appSecret / corpId 必填');
      const prev = readConfig();
      const next = { appKey, appSecret, corpId, agentId: agentId || prev.agentId || '' };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8');
      res.json({ ok: true, configured: true });
    }));

    // ---- 免登：前端拿 authCode → 用户身份（钉钉端内调用）----
    app.post('/auth/code', asyncRoute(async (req, res) => {
      const code = req.body?.code || req.body?.authCode;
      if (!code) throw badRequest('缺少免登授权码 code');
      const accessToken = await getAccessToken();
      const ding = await getUserIdByCode(code, accessToken);
      const user = {
        id: `ding-${ding.userid}`,
        username: ding.userid,
        display_name: ding.name || ding.nick || '钉钉用户',
        dept_id: ding.dept_id_list?.[0] ?? null,
        roles: ['employee'],
        perms: ['graph:view'],
        scope: 'self',
        dingtalk: ding,
      };
      const token = signAccessToken(user); // 复用 RS256 JWT，供 api.js 携带
      res.json({ accessToken: token, expiresIn: 1800, tokenType: 'Bearer', user });
    }));

    // ---- 通讯录 → 图谱：全量同步 ----
    app.post('/sync/org', asyncRoute(async (req, res) => {
      const accessToken = await getAccessToken();
      const t0 = Date.now();
      const depts = await fetchDepartments(accessToken);
      const seenEmp = new Set();
      const employees = [];
      for (const d of depts) {
        const list = await fetchEmployees(accessToken, d.id, seenEmp);
        employees.push(...list);
      }
      // 写入 knowledge 图谱
      const kn = await fetch('http://127.0.0.1:8087/graph/import-org', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ depts, employees, clear: true }),
        signal: AbortSignal.timeout(30000),
      });
      const knData = await kn.json().catch(() => ({}));
      if (!kn.ok) throw new Error(`写入 knowledge 失败: ${knData.message || knData.error || kn.status}`);
      const result = { departments: depts.length, employees: employees.length, ...knData, syncMs: Date.now() - t0 };
      res.status(201).json({ ok: true, ...result });
    }));

    ctx.addDebug(() => ({ configured: isConfigured(readConfig()), dataDir: DATA_DIR }));
  },
});

export { ctx, app };