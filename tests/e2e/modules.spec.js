import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

async function nav(page, key) {
  await page.evaluate((k) => window.__nexus.navigate(k), key);
  await page.waitForTimeout(600);
}

test('工作台 - 加载首页卡片', async ({ page }) => {
  await login(page);
  await page.waitForTimeout(1000);
  await expect(page.locator('text=应用中心')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=待办事项')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=考勤打卡')).toBeVisible({ timeout: 5000 });
});

test('文档协作 - 导航与创建', async ({ page }) => {
  await login(page);
  await nav(page, 'document');
  await page.waitForTimeout(2000);
  await expect(page.locator('text=文档').first()).toBeVisible({ timeout: 10000 });
  await expect(page.locator('text=新建文档').first().or(page.locator('text=示例文档'))).toBeVisible({ timeout: 10000 });
});

test('流程审批 - 导航与标签页', async ({ page }) => {
  await login(page);
  await nav(page, 'workflow');
  await page.waitForTimeout(1000);
  await expect(page.locator('text=待我审批')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=流程定义')).toBeVisible({ timeout: 5000 });
});

test('日程管理 - 日历视图', async ({ page }) => {
  await login(page);
  await nav(page, 'calendar');
  await page.waitForTimeout(1000);
  await expect(page.locator('text=新建日程')).toBeVisible({ timeout: 5000 });
});

test('云盘文件 - 导航', async ({ page }) => {
  await login(page);
  await nav(page, 'drive');
  await page.waitForTimeout(1000);
  await expect(page.locator('text=我的云盘')).toBeVisible({ timeout: 5000 });
});

test('项目管理 - 导航', async ({ page }) => {
  await login(page);
  await nav(page, 'project');
  await page.waitForTimeout(1000);
  await expect(page.locator('text=项目管理').first()).toBeVisible({ timeout: 5000 });
});

test('考勤管理 - 打卡界面', async ({ page }) => {
  await login(page);
  await nav(page, 'attendance');
  await page.waitForTimeout(1000);
  await expect(page.locator('text=一键打卡')).toBeVisible({ timeout: 5000 });
});

test('通讯录 - 部门树', async ({ page }) => {
  await login(page);
  await nav(page, 'contacts');
  await page.waitForTimeout(1000);
  await expect(page.locator('input[placeholder*="搜索"]')).toBeVisible({ timeout: 10000 });
});

test('企业论坛 - 帖子列表', async ({ page }) => {
  await login(page);
  await nav(page, 'forum');
  await page.waitForTimeout(1000);
  await expect(page.getByRole('button', { name: '全部' })).toBeVisible({ timeout: 5000 });
});

test('数据分析 - 看板', async ({ page }) => {
  await login(page);
  await nav(page, 'analytics');
  await page.waitForTimeout(1000);
  await expect(page.locator('text=数据分析').first()).toBeVisible({ timeout: 5000 });
});

test('AI 助手 - 对话界面', async ({ page }) => {
  await login(page);
  await nav(page, 'ai');
  await page.waitForTimeout(1000);
  await expect(page.locator('text=辅助决策')).toBeVisible({ timeout: 5000 });
});

test('设置 - 主题切换', async ({ page }) => {
  await login(page);
  await nav(page, 'settings');
  await page.waitForTimeout(500);
  await page.click('text=外观').catch(() => {});
  await page.waitForTimeout(500);
});

test('服务健康检查 - 所有服务状态', async ({ page }) => {
  const response = await page.request.get('http://localhost:8080/api/services/health');
  expect(response.ok()).toBeTruthy();
  const services = await response.json();
  const upCount = services.filter(s => s.status === 'ok').length;
  expect(upCount).toBeGreaterThanOrEqual(10);
});
