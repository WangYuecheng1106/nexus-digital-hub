import { test, expect } from '@playwright/test';

// 员工端已移除关系图谱入口；保�?API 级可用性检�?async function login(page) {
  await page.goto('/#/login');
  await page.waitForSelector('input[placeholder="用户�?]');
  await page.fill('input[placeholder="用户�?]', 'admin');
  await page.fill('input[placeholder="密码"]', 'Admin@1234');
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => window.__nexus?.user, null, { timeout: 15000 });
}

test('关系图谱 - 员工端已移除入口', async ({ page }) => {
  await login(page);
  await page.evaluate(() => window.__nexus.navigate('knowledge'));
  await page.waitForTimeout(800);
  // 应回退到消�?  const active = await page.evaluate(() => window.__nexus.activeModule);
  expect(active).toBe('im');
});

test('关系图谱 - 后端 stats 仍可�?, async ({ page }) => {
  await login(page);
  const token = await page.evaluate(() => localStorage.getItem('nexus_token'));
  const res = await page.request.get('http://localhost:8080/api/knowledge/graph/stats', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();
});
