import { test, expect } from '@playwright/test';

test.setTimeout(60000);

async function login(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('input[placeholder="用户名"]', { timeout: 20000 });
  await page.fill('input[placeholder="用户名"]', 'admin');
  await page.fill('input[placeholder="密码"]', 'Admin@1234');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=工作台', { timeout: 20000 });
  await page.waitForFunction(() => window.__nexus?.user, null, { timeout: 20000 });
}

async function nav(page, key) {
  await page.evaluate((k) => window.__nexus.navigate(k), key);
  await page.waitForTimeout(800);
}

test('截图 - 统一门户首页', async ({ page }) => {
  await login(page);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: './screenshots/01-workbench.png', fullPage: false });
});

test('截图 - IM 即时通讯界面', async ({ page }) => {
  await login(page);
  await nav(page, 'im');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: './screenshots/02-im.png' });
});

test('截图 - 视频会议界面', async ({ page }) => {
  await login(page);
  await nav(page, 'meeting');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: './screenshots/03-meeting.png' });
});

test('截图 - 关系图谱界面', async ({ page }) => {
  await login(page);
  await nav(page, 'knowledge');
  await page.waitForTimeout(5000);
  await page.screenshot({ path: './screenshots/04-knowledge-graph.png' });
});

test('截图 - 文档协作界面', async ({ page }) => {
  await login(page);
  await nav(page, 'document');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: './screenshots/05-document.png' });
});

test('截图 - 考勤管理界面', async ({ page }) => {
  await login(page);
  await nav(page, 'attendance');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: './screenshots/06-attendance.png' });
});

test('截图 - 流程审批界面', async ({ page }) => {
  await login(page);
  await nav(page, 'workflow');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: './screenshots/07-workflow.png' });
});

test('截图 - 数据分析界面', async ({ page }) => {
  await login(page);
  await nav(page, 'analytics');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: './screenshots/08-analytics.png' });
});
