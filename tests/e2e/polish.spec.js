import { test, expect } from '@playwright/test';

test.describe('polish: employee client', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    // Landing �?进入工作�?�?登录
    const enter = page.getByRole('button', { name: /在线体验|进入工作�? });
    if (await enter.first().isVisible().catch(() => false)) await enter.first().click();
    await page.waitForSelector('input[placeholder="用户�?], input[type="password"]', { timeout: 10000 });
    await page.fill('input[placeholder="用户�?]', 'admin').catch(async () => {
      await page.locator('input[type="text"], input:not([type])').first().fill('admin');
    });
    await page.fill('input[type="password"]', 'Admin@1234');
    await page.getByRole('button', { name: /登录/i }).click();
    await page.waitForFunction(() => window.__nexus?.user, null, { timeout: 20000 });
  });

  test('邮箱 MCP 收件箱可�?, async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('mail'));
    await expect(page.getByRole('button', { name: '收件�? })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/入职欢迎|安全提醒|会议纪要/).first()).toBeVisible({ timeout: 10000 });
  });

  test('IM 好友搜索与语音入�?, async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('im'));
    await expect(page.getByRole('button', { name: /好友/ })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /好友/ }).click();
    await expect(page.getByPlaceholder(/搜索姓名/)).toBeVisible();
    await page.getByRole('button', { name: '会话', exact: true }).click();
    await expect(page.locator('.nx-side')).toBeVisible();
  });

  test('员工端导航（无管理分�?图谱�?, async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('im'));
    const navCount = await page.locator('.nx-rail-item').count();
    expect(navCount).toBeGreaterThanOrEqual(12);
    expect(navCount).toBeLessThanOrEqual(14); // 12 模块 + 设置
    expect(await page.evaluate(() => window.__nexus.clientMode)).toBe('employee');
  });

  test('设置页无 AI 模型管理', async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('settings'));
    await expect(page.getByText('个人资料')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('AI 模型')).toHaveCount(0);
    await page.getByText('邮箱', { exact: true }).click();
    await expect(page.getByText('邮箱配置')).toBeVisible();
  });
});
