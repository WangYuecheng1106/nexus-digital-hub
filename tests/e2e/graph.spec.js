import { test, expect } from '@playwright/test';

// Nexus 关系图谱 · 单功能 e2e
// 钉钉 H5 微应用改造后：不再需要账号登录（端内免登 / 浏览器演示态）
test('图谱初始化：应用壳 + 画布 + 演示数据兜底', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1500);

  await expect(page.getByText('关系图谱').first()).toBeVisible();
  // 画布一定存在（或空态引导）
  const canvasCount = await page.locator('canvas').count();
  expect(canvasCount).toBeGreaterThan(0);

  // 若无数据则兜底载入演示数据，随后 stats 应有节点数
  await page.waitForTimeout(3000);
  const body = await page.evaluate(() => document.body?.innerText || '');
  const hasEmpty = body.includes('还没有图谱数据');
  if (hasEmpty) {
    await page.getByRole('button', { name: '载入演示数据' }).first().click();
    await page.waitForTimeout(3000);
  }
  const after = await page.evaluate(() => document.body?.innerText || '');
  expect(after).toMatch(/节点:\s*[1-9]/);

  expect(errors.filter((e) => !/favicon|dingtalk.*g\.alicdn|ERR_CONNECTION/i.test(e))).toHaveLength(0);
});

test('视图切换 + 搜索', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(2000);
  // 确保有数据
  const body = await page.evaluate(() => document.body?.innerText || '');
  if (body.includes('还没有图谱数据')) {
    await page.getByRole('button', { name: '载入演示数据' }).first().click();
    await page.waitForTimeout(3000);
  }
  // 视图切换
  await page.getByRole('button', { name: '组织树' }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: '关系图' }).first().click();
  await page.waitForTimeout(500);
  await expect(page.getByRole('button', { name: '组织树' }).first()).toBeVisible();
  // 搜索
  const input = page.locator('input[placeholder="搜索员工、部门…"]');
  await input.fill('研发');
  await page.waitForTimeout(800);
  await expect(page.locator('.search-pop').first()).toBeVisible();
});

test('钉钉接入引导存在', async ({ page }) => {
  await page.goto('/', { waitUntil: 'load', timeout: 45000 });
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: '接入钉钉' }).first()).toBeVisible();
});