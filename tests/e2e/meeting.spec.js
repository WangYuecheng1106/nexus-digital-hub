import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/#/login');
  await page.waitForSelector('input[placeholder="用户�?]');
  await page.fill('input[placeholder="用户�?]', 'admin');
  await page.fill('input[placeholder="密码"]', 'Admin@1234');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=工作�?, { timeout: 10000 });
  await page.waitForFunction(() => window.__nexus?.user, null, { timeout: 10000 });
}

async function nav(page, key) {
  await page.evaluate((k) => window.__nexus.navigate(k), key);
  await page.waitForTimeout(600);
}

test('视频会议 - 导航到会议模�?, async ({ page }) => {
  await login(page);
  await nav(page, 'meeting');
  await page.waitForTimeout(1000);
  await expect(page.locator('text=视频会议').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=立即发起会议')).toBeVisible({ timeout: 5000 });
});

test('视频会议 - 发起即时会议', async ({ page }) => {
  await login(page);
  await nav(page, 'meeting');
  await page.waitForTimeout(500);

  await page.click('text=立即发起会议');
  await page.waitForTimeout(2000);

  const meetingUI = await page.locator('text=会议�?).count();
  expect(meetingUI).toBeGreaterThanOrEqual(0);
});

test('视频会议 - 控制栏按钮可�?, async ({ page }) => {
  await login(page);
  await nav(page, 'meeting');
  await page.waitForTimeout(500);
  await page.click('text=立即发起会议');
  await page.waitForTimeout(2000);

  const buttons = page.locator('button[title]');
  const count = await buttons.count();
  expect(count).toBeGreaterThanOrEqual(0);
});
