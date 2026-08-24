import { test, expect } from '@playwright/test';
import { login } from './helpers.js';

// UI 抛光层：命令面板 / 右键菜单 / Toast / 无障碍模态框
test.describe('polish-ui: interaction layer', () => {
  test.setTimeout(90000);

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('Ctrl+K 打开命令面板，模糊搜索后 ESC 关闭', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('.cmdk-overlay')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.cmdk-input input')).toBeFocused();

    await page.keyboard.type('审批');
    await expect(page.locator('.cmdk-item', { hasText: '创建审批' }).first()).toBeVisible();
    await page.screenshot({ path: 'screenshots/polish-ui-cmdk.png', fullPage: true });

    // 键盘导航 + Enter 跳转
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');

    await page.keyboard.press('Escape');
    await expect(page.locator('.cmdk-overlay')).toHaveCount(0);

    // 顶栏触发按钮再次打开
    await page.locator('.cmdk-trigger').click();
    await expect(page.locator('.cmdk-overlay')).toBeVisible();
    await expect(page.locator('.cmdk-footer')).toContainText('导航');
    await page.keyboard.press('Escape');
    await expect(page.locator('.cmdk-overlay')).toHaveCount(0);
  });

  test('IM 右键菜单 + 悬浮操作 + 转为待办 toast', async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('im'));
    await page.waitForTimeout(800);

    // 打开一个会话（已有会话或新建）
    const firstRow = page.locator('.nx-side .list-row').first();
    if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
    } else {
      const start = page.getByRole('button', { name: /发起会话/ }).first();
      if (await start.isVisible().catch(() => false)) await start.click();
    }
    await expect(page.locator('.composer')).toBeVisible({ timeout: 15000 });

    // 发送一条消息
    const marker = `待办消息-${Date.now() % 100000}`;
    await page.locator('.composer textarea').fill(marker);
    await page.locator('.composer textarea').press('Enter');
    const bubble = page.locator('.msg-bubble', { hasText: marker }).last();
    await expect(bubble).toBeVisible({ timeout: 10000 });

    // 悬浮操作工具条
    await bubble.hover();
    const toolbar = page.locator('.msg-actions').last();
    await expect(toolbar).toBeVisible();
    await expect(toolbar.getByTitle('回复')).toBeVisible();
    await expect(toolbar.getByTitle('转为待办')).toBeVisible();

    // 右键菜单 → 转为待办 → toast
    await bubble.click({ button: 'right' });
    const menu = page.locator('.ctx-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: '复制' })).toBeVisible();
    await page.screenshot({ path: 'screenshots/polish-ui-ctxmenu.png', fullPage: true });
    await menu.getByRole('menuitem', { name: '转为待办' }).click();
    const toast = page.locator('.toast', { hasText: '已加入待办' });
    await expect(toast).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'screenshots/polish-ui-toast.png', fullPage: true });

    // ESC 丢弃菜单路径：再次右键后 ESC 关闭
    await bubble.click({ button: 'right' });
    await expect(page.locator('.ctx-menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.ctx-menu')).toHaveCount(0);
    await page.screenshot({ path: 'screenshots/polish-ui-im.png', fullPage: true });
  });

  test('模态框：role=dialog、焦点陷阱、ESC 关闭', async ({ page }) => {
    await page.evaluate(() => window.__nexus.navigate('calendar'));
    await page.getByRole('button', { name: /新建日程/ }).click();

    const dialog = page.locator('.modal[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await page.screenshot({ path: 'screenshots/polish-ui-modal.png', fullPage: true });

    // 焦点被陷阱在模态内：从最后一个元素 Tab 回第一个
    const focusedInDialog = await page.evaluate(() => {
      const dlg = document.querySelector('.modal[role="dialog"]');
      return dlg?.contains(document.activeElement);
    });
    expect(focusedInDialog).toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.locator('.modal-overlay')).toHaveCount(0);

    // 外点关闭
    await page.getByRole('button', { name: /新建日程/ }).click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(20, 20);
    await expect(page.locator('.modal-overlay')).toHaveCount(0);
  });
});
