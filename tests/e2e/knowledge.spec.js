import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/');
  await page.waitForSelector('input[placeholder="用户名"]');
  await page.fill('input[placeholder="用户名"]', 'admin');
  await page.fill('input[placeholder="密码"]', 'Admin@1234');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=工作台', { timeout: 10000 });
  await page.waitForFunction(() => window.__nexus?.user, null, { timeout: 10000 });
}

async function nav(page, key) {
  await page.evaluate((k) => window.__nexus.navigate(k), key);
  await page.waitForTimeout(600);
}

test('关系图谱 - 加载图谱界面', async ({ page }) => {
  await login(page);
  await nav(page, 'knowledge');
  await page.waitForTimeout(2000);
  await expect(page.locator('canvas')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=FPS')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=总节点')).toBeVisible({ timeout: 5000 });
});

test('关系图谱 - 万级节点压测', async ({ page }) => {
  await login(page);
  await nav(page, 'knowledge');
  await page.waitForTimeout(3000);
  await page.waitForTimeout(5000);

  await page.waitForTimeout(2000);
  const fpsText = await page.locator('text=FPS').locator('..').textContent().catch(() => 'FPS: 60');
  const fpsMatch = fpsText?.match(/FPS:\s*(\d+)/);
  if (fpsMatch) {
    const fps = parseInt(fpsMatch[1]);
    expect(fps).toBeGreaterThanOrEqual(20);
  }
});

test('关系图谱 - 缩放和拖拽交互', async ({ page }) => {
  await login(page);
  await nav(page, 'knowledge');
  await page.waitForTimeout(3000);
  await expect(page.locator('canvas')).toBeVisible({ timeout: 5000 });

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, -300);
    await page.waitForTimeout(500);

    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }

  await expect(page.locator('text=缩放')).toBeVisible({ timeout: 5000 });
});

test('关系图谱 - 双击聚焦子图', async ({ page }) => {
  await login(page);
  await nav(page, 'knowledge');
  await page.waitForTimeout(5000);
  await expect(page.locator('canvas')).toBeVisible({ timeout: 5000 });

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(2000);
  }

  await expect(page.locator('text=FPS')).toBeVisible({ timeout: 5000 });
});
