// nexus-ai：企业 AI 助手服务 — 数据层
// 功能：知识库 RAG 问答、自然语言转 SQL、会议/文档摘要、智能排期、语义搜索、翻译、智能提醒
import { openDb, migrate, snowflake } from '@nexus/shared';

export const db = openDb('ai');

// 知识库种子文档：用于 RAG 检索与语义搜索演示
const SEED_DOCS = [
  { doc_id: 'doc_policy_001', content: '公司差旅报销政策：员工出差产生的交通、住宿费用，需在出差结束后 7 个工作日内提交报销申请，单次出差住宿上限为 500 元/晚，机票需提前 3 天预订享受折扣。' },
  { doc_id: 'doc_policy_002', content: '考勤制度：员工工作日 9:00-18:00 为标准工时，弹性 30 分钟。迟到超过 3 次扣除当月全勤奖。请假需提前在系统提交审批。' },
  { doc_id: 'doc_hr_001', content: '入职流程：新员工入职当天需完成签到、领取工牌、开通企业邮箱与各业务系统账号、签订劳动合同，并由 HR 介绍公司文化与规章制度。' },
  { doc_id: 'doc_tech_001', content: 'Nexus 平台技术架构：采用微服务架构，共 19 个服务，统一网关 8080 端口，内部服务通过事件总线通信，数据库使用嵌入式 SQLite。' },
  { doc_id: 'doc_meeting_001', content: '会议管理规范：所有正式会议需提前 1 天预定会议室并发布议程，会议纪要 24 小时内同步至文档中心，重要决策需参会人员书面确认。' },
  { doc_id: 'doc_workflow_001', content: '审批流程配置：流程定义包含节点、条件分支、审批人。支持会签、或签、加签、转签。流程实例运行时按定义自动流转。' },
  { doc_id: 'doc_security_001', content: '信息安全规范：员工账号密码需 90 天更换一次，长度不少于 12 位，包含大小写字母与数字。敏感数据传输必须使用 HTTPS。' },
];

migrate(db, [
  ['conversations', `CREATE TABLE conversations (
    id TEXT PRIMARY KEY, user_id TEXT, title TEXT, created_at INTEGER)`],
  ['messages', `CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, created_at INTEGER)`],
  ['idx_msg_conv', `CREATE INDEX idx_msg_conv ON messages(conversation_id, created_at)`],
  ['embeddings', `CREATE TABLE embeddings (
    id TEXT PRIMARY KEY, doc_id TEXT, content TEXT, vector TEXT, created_at INTEGER)`],
]);

// 种子文档：仅当 embeddings 表为空时插入
if (db.get('SELECT COUNT(*) c FROM embeddings').c === 0) {
  for (const d of SEED_DOCS) {
    db.run('INSERT INTO embeddings (id, doc_id, content, vector, created_at) VALUES (?,?,?,?,?)',
      snowflake(), d.doc_id, d.content, JSON.stringify(fakeEmbedding(d.content)), Date.now());
  }
}

// 伪向量：基于字符 hash 生成 32 维向量，用于演示语义相似度排序
export function fakeEmbedding(text) {
  const vec = new Array(32).fill(0);
  for (let i = 0; i < text.length; i++) {
    vec[i % 32] = (vec[i % 32] + text.charCodeAt(i)) % 1000;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// 余弦相似度
function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// 语义搜索：返回 top-k 相关文档
export function semanticSearch(query, k = 5) {
  const qv = fakeEmbedding(query);
  const docs = db.all('SELECT * FROM embeddings');
  return docs
    .map((d) => ({ doc_id: d.doc_id, content: d.content, score: cosine(qv, JSON.parse(d.vector)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

// RAG 问答：检索相关文档，从内容中拼装答案与来源
export function ragAnswer(question) {
  const sources = semanticSearch(question, 3);
  if (sources.length === 0 || sources[0].score < 0.1) {
    return { reply: '抱歉，知识库中未找到与该问题相关的内容，请尝试换一种问法或联系管理员补充知识库。', sources: [] };
  }
  // 简化生成：取最相关文档内容片段作为答案
  const top = sources[0];
  const snippet = top.content.slice(0, 200);
  return {
    reply: `根据「${top.doc_id}」相关内容：${snippet}${top.content.length > 200 ? '...' : ''}`,
    sources: sources.map((s) => ({ doc_id: s.doc_id, score: Number(s.score.toFixed(3)) })),
  };
}

// 自然语言转 SQL（mock）：基于关键词识别表名与字段
export function nl2sql(question) {
  const q = String(question || '');
  const lower = q.toLowerCase();
  let sql = null, explanation = '未能识别查询意图';
  if (/(会议|meeting)/.test(lower)) {
    sql = "SELECT id, title, start_time, host_id FROM meetings WHERE status = 'pending' ORDER BY start_time";
    explanation = '识别为查询待开会议列表';
  } else if (/(审批|流程|任务)/.test(lower)) {
    sql = "SELECT id, title, status FROM workflow_tasks WHERE assignee = ? AND status = 'pending'";
    explanation = '识别为查询待办审批任务';
  } else if (/(考勤|打卡)/.test(lower)) {
    sql = "SELECT user_id, date, check_in_time, check_out_time FROM attendance_records WHERE date = date('now')";
    explanation = '识别为查询今日考勤记录';
  } else if (/(员工|人数|通讯录)/.test(lower)) {
    sql = 'SELECT id, name, department FROM users ORDER BY department';
    explanation = '识别为查询员工通讯录';
  }
  return { sql, explanation };
}

// 文本摘要：基于句子重要性（含关键词的句子优先），抽取式
export function summarize(text, ratio = 0.3) {
  const s = String(text || '');
  if (s.length < 80) return s;
  const sentences = s.split(/[。！？\n.!?]+/).filter((x) => x.trim().length > 5);
  if (sentences.length <= 2) return s;
  const keywords = ['关键', '重点', '必须', '需要', '注意', '要求', '规定', '政策', '流程'];
  const scored = sentences.map((sen, i) => {
    let score = 0;
    for (const kw of keywords) if (sen.includes(kw)) score += 2;
    score += Math.min(sen.length / 50, 2); // 长度适中加分
    score += i === 0 ? 1 : 0; // 首句加分
    return { sen, score, i };
  });
  const keep = Math.max(1, Math.round(sentences.length * ratio));
  const picked = scored.sort((a, b) => b.score - a.score).slice(0, keep).sort((a, b) => a.i - b.i);
  return picked.map((p) => p.sen.trim()).join('。') + '。';
}

// 翻译 mock：中英互译的常见词替换
const ZH_EN = { '你好': 'hello', '公司': 'company', '会议': 'meeting', '审批': 'approval', '文档': 'document', '员工': 'employee', '考勤': 'attendance', '请假': 'leave', '报销': 'reimbursement' };
const EN_ZH = Object.fromEntries(Object.entries(ZH_EN).map(([k, v]) => [v, k]));
export function translate(text, from, to) {
  let out = String(text || '');
  if (from === 'zh' && to === 'en') for (const [k, v] of Object.entries(ZH_EN)) out = out.replaceAll(k, v);
  else if (from === 'en' && to === 'zh') for (const [k, v] of Object.entries(EN_ZH)) out = out.replaceAll(k, v);
  else out = `[${from}->${to}] ${out}`;
  return out;
}

// 智能排期：返回最近可用的会议时间槽（mock：跳过午休与下班时段）
export function suggestMeetingSlots(durationMin = 60, count = 3) {
  const slots = [];
  const now = new Date();
  let cursor = new Date(now.getTime() + 30 * 60 * 1000);
  while (slots.length < count && cursor < new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)) {
    const h = cursor.getHours();
    if (h >= 9 && h < 12 || h >= 14 && h < 18) {
      slots.push({ start: cursor.toISOString(), end: new Date(cursor.getTime() + durationMin * 60 * 1000).toISOString() });
      cursor = new Date(cursor.getTime() + 90 * 60 * 1000);
    } else {
      cursor = new Date(cursor.getTime() + 30 * 60 * 1000);
    }
  }
  return slots;
}

// 会话与消息持久化
export function createConversation(userId, title) {
  const id = snowflake();
  db.run('INSERT INTO conversations (id, user_id, title, created_at) VALUES (?,?,?,?)', id, userId, title || '新对话', Date.now());
  return db.get('SELECT * FROM conversations WHERE id = ?', id);
}
export function listConversations(userId) {
  return db.all('SELECT * FROM conversations WHERE user_id = ? ORDER BY created_at DESC', userId);
}
export function addMessage(conversationId, role, content) {
  const id = snowflake();
  db.run('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?,?,?,?,?)', id, conversationId, role, content, Date.now());
  return db.get('SELECT * FROM messages WHERE id = ?', id);
}
export function listMessages(conversationId) {
  return db.all('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC', conversationId);
}
