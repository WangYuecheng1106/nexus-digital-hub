/** Shared login helper — handles Landing → Login flow. */
export async function login(page, username = 'admin', password = 'Admin@1234') {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(400);

  const pwd = page.locator('input[type="password"], input[placeholder="密码"]');
  try {
    await pwd.first().waitFor({ state: 'visible', timeout: 4000 });
  } catch {
    const enter = page.getByRole('button', { name: /进入工作台|在线体验/ }).first();
    await enter.click();
    await pwd.first().waitFor({ state: 'visible', timeout: 10000 });
  }

  const userInput = page.locator('input[placeholder="用户名"], input[type="text"]').first();
  await userInput.fill(username);
  await pwd.first().fill(password);
  await page.getByRole('button', { name: /登录/i }).click();
  await page.waitForFunction(() => window.__nexus?.user, null, { timeout: 20000 });
}
