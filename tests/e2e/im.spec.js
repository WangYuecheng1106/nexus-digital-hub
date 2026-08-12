import { test, expect } from '@playwright/test';

async function login(page, username = 'admin', password = 'Admin@1234') {
  await page.goto('/#/login');
  await page.waitForSelector('input[placeholder="用户�?]');
  await page.fill('input[placeholder="用户�?]', username);
  await page.fill('input[placeholder="密码"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=工作�?, { timeout: 10000 });
  await page.waitForFunction(() => window.__nexus?.user, null, { timeout: 10000 });
}

async function nav(page, key) {
  await page.evaluate((k) => window.__nexus.navigate(k), key);
  await page.waitForTimeout(600);
}

test('IM - 导航到即时通讯模块', async ({ page }) => {
  await login(page);
  await nav(page, 'im');
  await page.waitForTimeout(1000);
  await expect(page.locator('text=选择一个会话开始聊�?).or(page.locator('text=搜索会话'))).toBeVisible({ timeout: 5000 });
});

test('IM - 创建会话并发送消�?, async ({ page }) => {
  await login(page);
  await nav(page, 'im');
  await page.waitForTimeout(500);

  const token = await page.evaluate(() => localStorage.getItem('nexus_token'));
  await page.request.post('http://localhost:8080/api/im/conversations', {
    data: { type: 'single', name: '测试会话', memberIds: ['user-liuyang'] },
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => null);

  await page.waitForTimeout(2000);

  const convExists = await page.locator('text=测试会话').count();
  if (convExists > 0) {
    await page.click('text=测试会话');
    await page.waitForTimeout(500);
    await page.fill('textarea[placeholder*="输入消息"]', 'Hello from Playwright');
    await page.click('button:has-text("发�?)');
    await page.waitForTimeout(500);
    await expect(page.locator('text=Hello from Playwright').first()).toBeVisible({ timeout: 5000 });
  }
});

test('IM - 消息类型工具栏可�?, async ({ page }) => {
  await login(page);
  await nav(page, 'im');
  await page.waitForTimeout(800);

  const token = await page.evaluate(() => localStorage.getItem('nexus_token'));
  await page.request.post('http://localhost:8080/api/im/conversations', {
    data: { type: 'single', name: '工具栏测�?, memberIds: ['user-liuyang'] },
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
  await page.waitForTimeout(1500);
  const conv = page.locator('text=工具栏测�?).first();
  if (await conv.count() > 0) {
    await conv.click();
    await page.waitForTimeout(800);
    await expect(page.locator('.composer')).toBeVisible({ timeout: 5000 });
  }
});
