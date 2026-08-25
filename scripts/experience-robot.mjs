// Nexus 关系图谱 · 体验门禁（单页改造后）
// 走查：页面上线 → 图形加载（组织树/关系图）→ 演示数据兜底 → 搜索可用
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASE = process.env.EXPERIENCE_BASE || 'http://localhost:5173';
const REPORT = path.join(ROOT, 'data', 'experience-report.json');
const SHOTS = path.join(ROOT, 'screenshots', 'experience');
fs.mkdirSync(SHOTS, { recursive: true });

const findings = [];
function note(area, severity, title, detail = '') {
  findings.push({ area, severity, title, detail, at: new Date().toISOString() });
}

async function shot(page, name) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (err) => errors.push(err.message));

try {
  await page.goto(BASE, { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1200);

  // 1. 应用壳渲染
  const text = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim());
  if (!/关系图谱/.test(text)) note('aesthetic', 'P0', '页面未渲染「关系图谱」应用壳', text.slice(0, 200));
  else note('aesthetic', 'ok', '单页图谱应用壳渲染', '顶栏含「关系图谱」标题');

  // 2. 是否有图谱数据（空态或已载入）
  const hasCanvas = await page.locator('canvas').count();
  const emptyShown = await page.getByText('还没有图谱数据').count();
  if (hasCanvas === 0 && emptyShown === 0) {
    note('function', 'P0', '没有画布且无空态提示', '图谱无法初始化');
  } else if (emptyShown > 0) {
    note('function', 'ok', '空态引导可见', '提示接入钉钉/载入演示数据');
    // 空态下点「载入演示数据」
    await page.getByRole('button', { name: '载入演示数据' }).first().click();
    await page.waitForTimeout(2500);
    await shot(page, 'post-demo');
  }
  await shot(page, '01-graph-loading');

  // 3. 载入后 stats 数字
  const bodyText = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim());
  const statsMatch = /节点:\s*([\d,.]+)/.exec(bodyText);
  const hasDemoData = await page.getByText('演示态').count();
  if (statsMatch && parseInt(statsMatch[1].replace(/,/g, ''), 10) > 0) {
    note('function', 'ok', '图谱有数据', `节点 ${statsMatch[1]}`);
  } else {
    note('function', 'P1', '图谱数据为空(或未载入)', bodyText.slice(0, 200));
  }
  if (hasDemoData) note('compete', 'ok', '演示态标签正确', '未配钉钉时展示演示态');

  // 4. 视图切换（组织树 / 关系图）
  const segButtons = await page.getByRole('button', { name: /组织树|关系图/ }).count();
  if (segButtons >= 2) {
    await page.getByRole('button', { name: '关系图' }).click();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: '组织树' }).click();
    await page.waitForTimeout(800);
    note('detail', 'ok', '视图可切换', '组织树 ⇄ 关系图');
    await shot(page, 'mod-tree');
  } else {
    note('detail', 'P1', '视图切换缺失', '应有组织树/关系图切换');
  }

  // 5. 搜索可用
  const searchInput = page.locator('input[placeholder="搜索员工、部门…"]');
  if (await searchInput.count()) {
    await searchInput.first().fill('研发');
    await page.waitForTimeout(600);
    const pop = await page.locator('.search-pop').count();
    if (pop > 0) note('function', 'ok', '搜索可命中', '输入「研发」出现下拉结果');
    else note('function', 'P1', '搜索无下拉结果', '检查 search 接口/渲染');
    await shot(page, 'probe-search');
    await searchInput.first().fill('');
  } else {
    note('function', 'P1', '缺少搜索框', '应提供员工/部门搜索');
  }

  // 6. 部署 / 接入指引可见
  if (/接入钉钉/.test(await page.evaluate(() => document.body?.innerText || ''))) {
    note('compete', 'ok', '钉钉接入入口在', '未配置时提供「接入钉钉」引导');
  }
} catch (e) {
  console.error('experience failed', e);
  process.exitCode = 1;
} finally {
  const p0 = findings.filter((f) => f.severity === 'P0').length;
  const p1 = findings.filter((f) => f.severity === 'P1').length;
  const ok = findings.filter((f) => f.severity === 'ok').length;
  const e2 = errors.filter((x) => !/favicon|access.*google|dingtalk.*g\.alicdn|ERR_CONNECTION/.test(x));
  fs.writeFileSync(REPORT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    base: BASE,
    consoleErrors: e2.slice(0, 10),
    findings,
    scores: {
      aesthetic: p0 ? 10 : ok ? 100 : 50,
      detail: ok ? 100 : 50,
      function: p0 ? 10 : p1 ? 60 : 100,
      compete: ok ? 100 : 50,
      system: ok ? 100 : 50,
    },
    counts: { p0, p1, ok },
  }, null, 2), 'utf8');
  console.log('wrote', REPORT);
  console.log('P0', p0, 'P1', p1, 'ok', ok);
  await browser.close();
}