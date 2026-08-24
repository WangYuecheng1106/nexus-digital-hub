import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

async function ensureLoginForm(page) {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  const pwd = page.locator('input[placeholder="密码"], input[type="password"]');
  try {
    await pwd.first().waitFor({ state: 'visible', timeout: 4000 });
  } catch {
    await page.getByRole('button', { name: /进入工作台|在线体验/ }).first().click();
    await pwd.first().waitFor({ state: 'visible', timeout: 10000 });
  }
}

test('登录流程 - 管理员登录获取JWT', async ({ page }) => {
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push(err.message));

  await login(page, 'admin', 'Admin@1234');

  const nexus = await page.evaluate(() => window.__nexus);
  expect(nexus).toBeTruthy();
  expect(nexus.user).toBeTruthy();
  expect(nexus.user.username).toBe('admin');
  expect(nexus.user.roles).toContain('admin');

  expect(errors.filter(e => !e.includes('favicon') && !e.includes('502'))).toHaveLength(0);
});

test('登录流程 - 普通员工登录', async ({ page }) => {
  await login(page, 'liuyang', 'Nexus@1234');
  const nexus = await page.evaluate(() => window.__nexus);
  expect(nexus.user.roles).toContain('employee');
});

test('登录失败 - 错误密码锁定', async ({ page }) => {
  await ensureLoginForm(page);
  await page.fill('input[placeholder="用户名"]', 'admin');
  await page.fill('input[placeholder="密码"]', 'wrongpassword');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=用户名或密码错误', { timeout: 5000 });
});
