import { test, expect } from '@playwright/test';

async function login(page) {
  await page.goto('/#/login');
  await page.waitForSelector('input[placeholder="用户�?]');
  await page.fill('input[placeholder="用户�?]', 'admin');
  await page.fill('input[placeholder="密码"]', 'Admin@1234');
  await page.click('button[type="submit"]');
  await page.waitForSelector('text=应用中心', { timeout: 10000 });
}

test('功能回归：登录→工作台→IM发消息→会议→审�?, async ({ page }) => {
  test.setTimeout(90000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await login(page);
  await page.screenshot({ path: 'screenshots/ui-workbench.png' });

  // IM �?通过侧栏 title 点击；若失败则走 hash 路由
  await page.locator('.nx-rail-item[title="消息"]').click();
  await page.waitForTimeout(600);
  if (!(await page.locator('text=会话').count())) {
    await page.evaluate(() => { window.location.hash = '#/im'; });
    await page.waitForTimeout(600);
  }
  const newBtn = page.locator('.nx-side-head button').first();
  if (await newBtn.count()) await newBtn.click();
  await page.waitForTimeout(1000);
  const conv = page.locator('.list-row').first();
  if (await conv.count()) await conv.click();
  await page.waitForTimeout(400);
  const box = page.locator('textarea[placeholder*="输入消息"]');
  if (await box.count()) {
    await box.fill('功能可用验证 ' + Date.now());
    await page.locator('.composer button.btn-primary').click();
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: 'screenshots/ui-im.png' });

  await page.locator('.nx-rail-item[title="会议"]').click();
  await page.waitForTimeout(400);
  await page.getByText('立即发起会议').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: 'screenshots/ui-meeting.png' });
  const leave = page.locator('button[title="离开"]');
  if (await leave.count()) await leave.click();

  await page.locator('.nx-rail-item[title="审批"]').click();
  await page.waitForTimeout(600);
  await expect(page.getByText('待我审批')).toBeVisible();
  await page.screenshot({ path: 'screenshots/ui-workflow.png' });

  await page.locator('.nx-rail-item[title="项目"]').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'screenshots/ui-project.png' });

  await page.locator('.nx-rail-item[title="通讯�?]').click();
  await page.waitForTimeout(600);
  await expect(page.locator('input[placeholder*="搜索"]')).toBeVisible();
  await page.screenshot({ path: 'screenshots/ui-contacts.png' });
  expect(errors.filter((e) => !e.includes('getUserMedia'))).toEqual([]);
});
