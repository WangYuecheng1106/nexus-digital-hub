/**
 * Nexus 深度体验机器人
 * 对照《严重问题.md》五条线：审美 / 细节 / 功能 / 竞争力 / 成体系
 * 登录后走完所有模块，截图、点按钮、记死交互，输出 JSON 报告。
 *
 * 用法：先 npm run dev，再 node scripts/experience-robot.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.NEXUS_URL || 'http://localhost:5173';
const USER = process.env.NEXUS_USER || 'admin';
const PASS = process.env.NEXUS_PASS || 'Admin@1234';
const OUT_DIR = path.resolve('screenshots/experience');
const REPORT = path.resolve('data/experience-report.json');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(path.dirname(REPORT), { recursive: true });

const MODULES = [
  'workbench', 'im', 'mail', 'meeting', 'contacts', 'document', 'drive',
  'calendar', 'workflow', 'project', 'attendance', 'forum', 'knowledge',
  'analytics', 'ai', 'settings',
];

const findings = [];
const shots = [];
const consoleErrors = [];
const pageErrors = [];

function note(area, severity, title, detail, extra = {}) {
  findings.push({
    area, // aesthetic | detail | function | compete | system
    severity, // P0 | P1 | P2 | ok
    title,
    detail,
    at: new Date().toISOString(),
    ...extra,
  });
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push({ name, file });
  return file;
}

async function login(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(500);
  const pwd = page.locator('input[type="password"], input[placeholder="密码"]');
  try {
    await pwd.first().waitFor({ state: 'visible', timeout: 4000 });
  } catch {
    // 进入官网：可能直接是登录页，也可能先弹「合规告知」确认框
    const enter = page.getByRole('button', { name: /立即体验|免费试用|进入工作台|在线体验/ }).first();
    if (await enter.isVisible().catch(() => false)) await enter.click();
    const agree = page.getByRole('button', { name: /同意并继续/ });
    if (await agree.count().then((n) => n > 0 && agree.first().isVisible().catch(() => false))) {
      await page.locator('.landing-consent-check input[type="checkbox"]').first().check();
      await agree.first().click();
    }
    await pwd.first().waitFor({ state: 'visible', timeout: 12000 });
  }
  await shot(page, '00-login');
  await page.locator('input[placeholder="用户名"], input[type="text"]').first().fill(USER);
  await pwd.first().fill(PASS);
  await page.getByRole('button', { name: /登录/i }).click();
  await page.waitForFunction(() => window.__nexus?.user, null, { timeout: 20000 });
}

async function visibleText(page, limit = 400) {
  return page.evaluate((n) => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, n), limit);
}

async function countInteractive(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const deadTitles = [];
    for (const b of buttons) {
      const title = b.getAttribute('title') || b.innerText?.trim() || '';
      const hasOnclick = Boolean(b.getAttribute('onclick') || b.onclick);
      // React handlers are not visible on onclick; we only flag known chrome with no type=submit and empty dataset
      if (!title) continue;
      if ((title === '附件' || title === '图片') && !hasOnclick) deadTitles.push(title);
    }
    return {
      buttons: buttons.length,
      inputs: document.querySelectorAll('input, textarea, select').length,
      modals: document.querySelectorAll('.modal-overlay, [role="dialog"]').length,
      toasts: document.querySelectorAll('.toast').length,
      empty: document.querySelectorAll('.empty').length,
      deadTitles,
    };
  });
}

async function probeLanding(page) {
  await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(600);
  await shot(page, '00-landing');
  const text = await visibleText(page, 1200);
  const hasHero = /Nexus|工作台|在线体验|进入工作台/.test(text);
  if (!hasHero) note('aesthetic', 'P0', '落地页缺少品牌叙事', text.slice(0, 160));
  else note('aesthetic', 'ok', '落地页有品牌入口', '存在进入工作台 / 在线体验 CTA');
  const changelogRows = await page.locator('#nx-changelog .landing-log-row').count().catch(() => 0);
  if (changelogRows === 0) note('aesthetic', 'P1', '落地页缺少 Changelog', '对标 cursor.com 应有更新段落');
  else note('aesthetic', 'ok', '落地页有 Changelog', `#nx-changelog 更新 ${changelogRows} 条`);
  if (!/产品窗|工作台|上午好/.test(text)) note('aesthetic', 'P1', '落地页缺少产品窗', '应对标 cursor.com 的产品演示窗');
}

async function probeCmdk(page) {
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(400);
  const overlay = page.locator('.cmdk-overlay');
  const ok = await overlay.isVisible().catch(() => false);
  await shot(page, 'probe-cmdk');
  if (!ok) {
    note('detail', 'P0', 'Ctrl+K 命令面板未出现', '钉钉/飞书级全局搜问入口缺失或未挂载');
    return;
  }
  note('detail', 'ok', '命令面板可打开', 'Ctrl+K 出现 .cmdk-overlay');
  await page.keyboard.type('审批');
  await page.waitForTimeout(300);
  const hit = await page.locator('.cmdk-item', { hasText: /审批/ }).first().isVisible().catch(() => false);
  if (!hit) note('system', 'P1', '命令面板搜「审批」无结果', '全局搜问未能连通审批模块');
  else note('system', 'ok', '命令面板可搜到审批', '模糊搜索命中审批相关项');
  await page.keyboard.press('Escape');
}

async function probeIm(page) {
  await page.evaluate(() => window.__nexus.navigate('im'));
  await page.waitForTimeout(900);
  await shot(page, 'mod-im');

  const start = page.getByRole('button', { name: /发起会话/ }).first();
  if (await start.isVisible().catch(() => false)) await start.click();
  const row = page.locator('.nx-side .list-row').first();
  if (await row.isVisible().catch(() => false)) await row.click();
  await page.waitForTimeout(600);

  const composer = page.locator('.composer textarea');
  if (!(await composer.isVisible().catch(() => false))) {
    note('function', 'P0', 'IM 无法进入会话', '无 composer，消息模块不可用');
    return;
  }

  const marker = `体验机器人-${Date.now() % 100000}`;
  await composer.fill(marker);
  await composer.press('Enter');
  const bubble = page.locator('.msg-bubble', { hasText: marker }).last();
  const sent = await bubble.isVisible({ timeout: 8000 }).catch(() => false);
  if (!sent) note('function', 'P0', 'IM 发消息失败', marker);
  else note('function', 'ok', 'IM 可发文字消息', marker);

  if (sent) {
    await bubble.hover();
    const toolbar = page.locator('.msg-actions').last();
    const hoverOk = await toolbar.isVisible().catch(() => false);
    if (!hoverOk) note('detail', 'P0', '消息悬停无操作条', '钉钉/飞书消息快捷操作缺失');
    else note('detail', 'ok', '消息悬停操作条出现', '回复/复制/转发/转待办');

    await bubble.click({ button: 'right' });
    const menu = page.locator('.ctx-menu');
    const menuOk = await menu.isVisible().catch(() => false);
    await shot(page, 'probe-im-ctx');
    if (!menuOk) note('detail', 'P0', '消息右键无弹窗', '严重问题#2 典型：点击对话框没有弹窗');
    else {
      note('detail', 'ok', '消息右键弹出上下文菜单', '复制/转待办/撤回');
      const todoItem = menu.getByRole('menuitem', { name: /转为待办/ });
      if (await todoItem.isVisible().catch(() => false)) {
        await todoItem.click();
        await page.waitForTimeout(500);
        const toast = page.locator('.toast');
        const toastOk = await toast.first().isVisible().catch(() => false);
        if (toastOk) note('system', 'ok', '消息→待办闭环可用', '右键转为待办出现 toast');
        else note('system', 'P1', '转为待办无反馈', '可能写入失败或 toast 未挂载');
      }
    }
    await page.keyboard.press('Escape');
  }

  const attach = page.locator('.composer button[title="附件"]');
  const image = page.locator('.composer button[title="图片"]');
  if (await attach.isVisible().catch(() => false)) {
    await attach.click();
    await page.waitForTimeout(300);
    const dialog = await page.locator('.modal-overlay, [role="dialog"], input[type="file"]').count();
    if (dialog === 0) note('detail', 'P0', 'IM 附件按钮无弹窗/文件选择', '典型死按钮：看得见点不了');
    else note('detail', 'ok', 'IM 附件有承接', `dialogs=${dialog}`);
  }
  if (await image.isVisible().catch(() => false)) {
    await image.click();
    await page.waitForTimeout(300);
    const dialog = await page.locator('.modal-overlay, [role="dialog"], input[type="file"]').count();
    if (dialog === 0) note('detail', 'P0', 'IM 图片按钮无弹窗/文件选择', '与附件同为装饰按钮');
  }
}

async function probeModal(page, module, openSelector, titleRe) {
  await page.evaluate((k) => window.__nexus.navigate(k), module);
  await page.waitForTimeout(700);
  const btn = page.getByRole('button', { name: openSelector }).first();
  if (!(await btn.isVisible().catch(() => false))) {
    note('detail', 'P1', `${module} 找不到「${openSelector}」`, '创建入口不明显或未渲染');
    return;
  }
  await btn.click();
  await page.waitForTimeout(400);
  const dlg = page.locator('[role="dialog"], .modal').first();
  const ok = await dlg.isVisible().catch(() => false);
  await shot(page, `probe-modal-${module}`);
  if (!ok) {
    note('detail', 'P0', `${module} 点击「${openSelector}」无弹窗`, '严重问题#2');
    return;
  }
  note('detail', 'ok', `${module} 弹窗出现`, String(titleRe));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const still = await dlg.isVisible().catch(() => false);
  if (still) note('detail', 'P1', `${module} ESC 不能关弹窗`, '无障碍/细节不到位');
  else note('detail', 'ok', `${module} ESC 关闭弹窗`, '');
}

async function probeAi(page) {
  await page.evaluate(() => window.__nexus.navigate('ai'));
  await page.waitForTimeout(800);
  await shot(page, 'mod-ai');
  const agent = await page.getByText('AgentOS').first().isVisible().catch(() => false);
  if (!agent) note('compete', 'P1', 'AI 页无 AgentOS 标识', '竞争力叙事未落到界面');
  else note('compete', 'ok', 'AI 页展示 AgentOS', '有差异化标签');

  const box = page.locator('.composer input, .composer textarea').first();
  if (await box.isVisible().catch(() => false)) {
    await box.fill('提醒我下午5点提交周报');
    await page.getByRole('button', { name: /发送/ }).click();
    await page.waitForTimeout(2500);
    await shot(page, 'probe-ai-tool');
    const body = await visibleText(page, 900);
    if (/\[object Object\]/.test(body)) {
      note('function', 'P0', 'AI 来源渲染成 [object Object]', 'RAG sources 未序列化，截图 probe-ai-tool 可见');
    }
    const tool = await page.locator('.msg-bubble').filter({ hasText: /已为|创建待办|执行成功|工具调用/ }).first().isVisible().catch(() => false);
    const mismatched = /审批工作流|doc_workflow/.test(body) && /提醒我|周报/.test(body);
    if (tool) note('compete', 'ok', 'AI 对话能调用工具', body.slice(0, 180));
    else if (mismatched) note('compete', 'P0', 'AgentOS 未干活：提醒指令被 RAG 答成审批文档', '对标钉钉悟空 CLI：自然语言应落到 create_todo / calendar，而不是检索碎片');
    else note('compete', 'P0', 'AI 仍是问答玩具，未干活', '输入「提醒我…」未见工具调用卡片。对标钉钉悟空/Agent OS');
  }
}

async function probeWorkflow(page) {
  await page.evaluate(() => window.__nexus.navigate('workflow'));
  await page.waitForTimeout(800);
  await shot(page, 'mod-workflow');
  const pending = page.getByRole('button', { name: '待我审批' });
  await pending.click().catch(() => {});
  const cards = await page.locator('.card').count();
  if (cards === 0) note('function', 'P1', '审批待办为空且无模板引导', '对标钉钉 OA / WeLink 飞羽 30+ 模板');
  await page.getByRole('button', { name: '发起审批' }).click().catch(() => {});
  await page.waitForTimeout(500);
  await shot(page, 'mod-workflow-templates');
  const tpls = await page.locator('.card, .list-row').count();
  if (tpls < 3) note('function', 'P1', '审批模板过少', `可见项 ${tpls}，飞羽级需要 30+`);
}

async function probeKnowledge(page) {
  await page.evaluate(() => window.__nexus.navigate('knowledge'));
  await page.waitForTimeout(1500);
  await shot(page, 'mod-knowledge');
  const canvas = await page.locator('canvas').count();
  if (canvas === 0) note('function', 'P0', '关系图谱无画布', '关键功能不能用');
  else {
    const stats = await page.evaluate(() => {
      const t = document.body.innerText || '';
      const nodes = /总节点[^\d]*([\d,]+)/.exec(t)?.[1];
      const viewport = /视口节点[^\d]*([\d,]+)/.exec(t)?.[1];
      return { nodes, viewport, text: t.slice(0, 220) };
    });
    const vp = Number(String(stats.viewport || '0').replace(/,/g, ''));
    const total = Number(String(stats.nodes || '0').replace(/,/g, ''));
    if (vp <= 0) {
      note('function', 'P0', '图谱视口节点为 0 或画面不可见', `总节点=${stats.nodes || 0} 视口=${stats.viewport || 0}。评审重点`);
    } else note('function', 'ok', '关系图谱画布渲染', `canvas=${canvas} nodes=${total} viewport=${vp}`);
  }
}

async function probeMeeting(page) {
  await page.evaluate(() => window.__nexus.navigate('meeting'));
  await page.waitForTimeout(800);
  const lobby = await visibleText(page, 400);
  if (!/最近会议|听记/.test(lobby)) {
    note('function', 'P1', '会议大厅缺少最近会议/听记', '不得只有一张营销卡');
  }
  const create = page.getByRole('button', { name: /立即开会|发起会议|立即发起会议|创建/ }).first();
  if (await create.isVisible().catch(() => false)) {
    note('function', 'ok', '会议有发起入口', await create.innerText());
    await create.click();
    await page.waitForTimeout(1200);
    await shot(page, 'mod-meeting');
    const inCall = await page.locator('button[title="静音"], button[title="离开"]').count();
    if (inCall < 1) note('function', 'P0', '发起会议后未进入会中页', await visibleText(page, 180));
    else note('function', 'ok', '会中页控件可见', '静音/离开');
    const hang = page.locator('button[title="离开"]').first();
    if (await hang.isVisible().catch(() => false)) await hang.click();
  } else {
    await shot(page, 'mod-meeting');
    note('function', 'P1', '会议发起入口不明显', lobby);
  }
}

async function probeMail(page) {
  await page.evaluate(() => window.__nexus.navigate('mail'));
  await page.waitForTimeout(900);
  await shot(page, 'mod-mail');
  const inbox = await page.getByText(/收件箱|入职欢迎|安全提醒|会议纪要|暂无/).first().isVisible().catch(() => false);
  if (!inbox) note('function', 'P0', '邮箱收件箱无内容也无空态', 'MCP 邮箱可能未接通');
  else note('function', 'ok', '邮箱模块有收件箱呈现', '');
}

async function probeVisualGaps(page) {
  await page.evaluate(() => window.__nexus.navigate('workbench'));
  await page.waitForTimeout(400);
  const wb = await visibleText(page, 400);
  if (/加载中/.test(wb) && !/待办|应用中心/.test(wb)) {
    note('aesthetic', 'P0', '工作台长时间停在加载中', '首屏空壳，钉钉工作台应是待办+应用九宫格瞬间可见');
  } else if (/应用中心|待办事项/.test(wb)) {
    note('aesthetic', 'ok', '工作台有应用中心', '九宫格入口存在');
  }

  await page.evaluate(() => window.__nexus.navigate('forum'));
  await page.waitForTimeout(800);
  const forum = await page.evaluate(() => {
    const t = document.body.innerText || '';
    const zeros = (t.match(/板块[\s\S]{0,80}/) || [''])[0];
    const posts = [...document.querySelectorAll('.card')].length;
    return { zeros, posts, hasZeroCounts: /公司动态[\s\S]{0,12}0/.test(t) && posts > 0 };
  });
  if (forum.hasZeroCounts) {
    note('detail', 'P1', '论坛板块计数全 0，列表却有帖', '数据与 UI 脱节，不成体系');
  }

  await page.evaluate(() => window.__nexus.navigate('contacts'));
  await page.waitForTimeout(700);
  const contacts = await page.evaluate(() => {
    const t = document.body.innerText || '';
    const dup = (t.match(/Nexus 集团/g) || []).length;
    const qmarks = /\?{3,}/.test(t);
    const zeroOrg = /研发部\s*\(0\)/.test(t);
    return { dup, qmarks, zeroOrg, slice: t.slice(0, 200) };
  });
  if (contacts.dup >= 2) note('detail', 'P1', '通讯录组织树重复渲染', `Nexus 集团出现 ${contacts.dup} 次`);
  if (contacts.qmarks) note('detail', 'P1', '通讯录职位显示 ?????', '刘洋等人员数据未映射角色名');
  if (contacts.zeroOrg) note('detail', 'P1', '部门人数显示 (0) 但右侧有人', '组织树与人员列表未连通');

  await page.evaluate(() => window.__nexus.navigate('mail'));
  await page.waitForTimeout(600);
  const mailItem = page.locator('.list-row, [class*="mail"]').filter({ hasText: /入职欢迎|会议纪要|安全提醒/ }).first();
  if (await mailItem.isVisible().catch(() => false)) {
    await mailItem.click();
    await page.waitForTimeout(400);
    await shot(page, 'probe-mail-open');
    const opened = await page.getByText(/选择一封邮件/).isVisible().catch(() => false);
    if (opened) note('detail', 'P0', '点击邮件列表无正文弹层', '严重问题#2：点了没有下文');
    else note('detail', 'ok', '邮件可打开正文', '');
  }

  await page.evaluate(() => window.__nexus.navigate('settings'));
  await page.waitForTimeout(500);
  const top = await page.locator('.nx-topbar').innerText().catch(() => '');
  if (/工作台/.test(top)) note('detail', 'P1', '设置页顶栏仍写「工作台」', '模块标题未随路由更新');
}

async function walkModules(page) {
  for (const key of MODULES) {
    await page.evaluate((k) => window.__nexus.navigate(k), key);
    await page.waitForTimeout(key === 'workbench' ? 1400 : 700);
    await shot(page, `mod-${key}`);
    const stats = await countInteractive(page);
    const text = await visibleText(page, 280);
    const emptyHeavy = stats.empty > 0 && stats.buttons < 3;
    if (emptyHeavy) note('function', 'P1', `${key} 几乎空壳`, text);
    if (/失败|未就绪|无法连接|error/i.test(text)) {
      note('function', 'P0', `${key} 页面报错`, text);
    }
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'zh-CN',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(err.message));

try {
  await probeLanding(page);
  await login(page);
  await shot(page, '01-workbench');
  await probeCmdk(page);
  await walkModules(page);
  await probeVisualGaps(page);
  await probeIm(page);
  await probeModal(page, 'calendar', /新建日程/, /新建日程/);
  await probeModal(page, 'project', /新建任务/, /新建任务/);
  await probeModal(page, 'forum', /发布|发帖/, /发布/);
  await probeAi(page);
  await probeWorkflow(page);
  await probeKnowledge(page);
  await probeMeeting(page);
  await probeMail(page);
} catch (e) {
  note('function', 'P0', '体验机器人中断', e.message);
} finally {
  const byArea = { aesthetic: [], detail: [], function: [], compete: [], system: [] };
  for (const f of findings) (byArea[f.area] || (byArea[f.area] = [])).push(f);
  const score = (arr) => {
    const p0 = arr.filter((x) => x.severity === 'P0').length;
    const p1 = arr.filter((x) => x.severity === 'P1').length;
    const ok = arr.filter((x) => x.severity === 'ok').length;
    const total = Math.max(1, p0 + p1 + ok);
    return Math.max(0, Math.min(100, Math.round((ok * 100 - p0 * 25 - p1 * 10) / total + 50)));
  };
  const report = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    shots,
    consoleErrors: consoleErrors.slice(0, 40),
    pageErrors: pageErrors.slice(0, 20),
    findings,
    scores: {
      aesthetic: score(byArea.aesthetic),
      detail: score(byArea.detail),
      function: score(byArea.function),
      compete: score(byArea.compete),
      system: score(byArea.system),
    },
    counts: {
      p0: findings.filter((f) => f.severity === 'P0').length,
      p1: findings.filter((f) => f.severity === 'P1').length,
      ok: findings.filter((f) => f.severity === 'ok').length,
    },
  };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), 'utf8');
  console.log('wrote', REPORT);
  console.log('P0', report.counts.p0, 'P1', report.counts.p1, 'ok', report.counts.ok);
  console.log('scores', JSON.stringify(report.scores));
  await browser.close();
}
