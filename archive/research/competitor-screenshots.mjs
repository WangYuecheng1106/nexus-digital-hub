/**
 * 同类产品官网截图（钉钉 / WeLink / 飞书 / 企业微信）
 * 用于对照《严重问题.md》审美与产品叙事。
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('screenshots/competitor-research');
fs.mkdirSync(DIR, { recursive: true });

const pages = [
  { id: 'dingtalk-home', url: 'https://www.dingtalk.com/' },
  { id: 'dingtalk-ai', url: 'https://www.dingtalk.com/qianwen' },
  { id: 'feishu-home', url: 'https://www.feishu.cn/' },
  { id: 'wecom-home', url: 'https://work.weixin.qq.com/' },
  { id: 'welink-home', url: 'https://www.huaweicloud.com/product/welink.html' },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'zh-CN',
  viewport: { width: 1440, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
});
const page = await context.newPage();
const result = [];

for (const item of pages) {
  try {
    console.log('browse', item.id);
    await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2800);
    const file = path.join(DIR, `${item.id}-20260813.png`);
    await page.screenshot({ path: file, fullPage: false });
    const title = await page.title();
    const text = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 2500));
    result.push({ ...item, ok: true, title, text, file });
  } catch (e) {
    console.error('fail', item.id, e.message);
    result.push({ ...item, ok: false, error: e.message });
  }
}

fs.writeFileSync(path.resolve('data/competitor-browse-20260813.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), items: result }, null, 2), 'utf8');
await browser.close();
console.log('done', result.filter((x) => x.ok).length, '/', result.length);
