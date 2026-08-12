import { test, expect } from '@playwright/test';

test.describe('polish: unified client', () => {
  test.setTimeout(60000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.fill('input[type="password"]', 'Admin@1234');
    const userInput = page.locator('input[type="text"], input:not([type])').first();
    await userInput.fill('admin');
    await page.getByRole('button', { name: /登录/i }).click();
    await page.waitForFunction(() => window.__nexus?.user, null, { timeout: 20000 });
  });

  test('邮箱 MCP 收件箱可用', async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('mail'));
    await expect(page.getByRole('button', { name: '收件箱' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/入职欢迎|安全提醒|会议纪要/).first()).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'screenshots/polish-mail.png', fullPage: true });
  });

  test('IM 好友与语音入口', async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('im'));
    await expect(page.getByRole('button', { name: /好友/ })).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: /好友/ }).click();
    await expect(page.getByPlaceholder('对方用户 ID')).toBeVisible();
    await page.getByRole('button', { name: '会话', exact: true }).click();
    const start = page.getByRole('button', { name: /发起会话/ }).first();
    if (await start.isVisible().catch(() => false)) await start.click();
    await page.waitForTimeout(800);
    await expect(page.locator('.composer')).toBeVisible();
    await page.screenshot({ path: 'screenshots/polish-im-friends.png', fullPage: true });
  });

  test('统一端完整导航', async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('workbench'));
    await expect(page.getByText('工作台', { exact: true }).first()).toBeVisible({ timeout: 10000 });
    const navCount = await page.locator('.nx-rail-item').count();
    expect(navCount).toBeGreaterThanOrEqual(15); // 完整导航
    await page.screenshot({ path: 'screenshots/polish-unified.png', fullPage: true });
  });

  test('AI 模型配置页', async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('settings'));
    await page.getByText('AI 模型').click();
    await expect(page.getByText('通义千问', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('DeepSeek', { exact: true })).toBeVisible();
    await page.getByText('邮箱', { exact: true }).click();
    await expect(page.getByText('邮箱配置')).toBeVisible();
    await page.screenshot({ path: 'screenshots/polish-ai-providers.png', fullPage: true });
  });

  test('图谱 AI 整理人员', async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('knowledge'));
    await expect(page.getByRole('button', { name: /AI 整理人员/ })).toBeVisible({ timeout: 25000 });
    await page.getByRole('button', { name: /AI 整理人员/ }).click();
    await expect(page.getByText(/已将|整理|人/)).toBeVisible({ timeout: 25000 });
    await page.screenshot({ path: 'screenshots/polish-graph-people.png', fullPage: true });
  });
});
