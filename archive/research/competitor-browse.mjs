/**
 * 竞品与 B 站调研抓取（Playwright）
 * 输出到 data/competitor-browse.json
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve('data/competitor-browse.json');
const shots = path.resolve('screenshots/competitor-research');
fs.mkdirSync(shots, { recursive: true });

const pages = [
  { id: 'viva', url: 'https://enablement.microsoft.com/zh-cn/viva/engage/', shot: 'viva-engage.png' },
  { id: 'dingtalk', url: 'https://www.dingtalk.com/', shot: 'dingtalk.png' },
  { id: 'welink', url: 'https://www.huaweicloud.com/product/welink.html', shot: 'welink.png' },
  { id: 'bili_search', url: 'https://search.bilibili.com/all?keyword=%E8%8B%8F%E6%98%9F%E6%B2%B3%E7%89%9B%E9%80%9A%20%E9%92%89%E9%92%89', shot: 'bili-suxinghe-dingtalk.png' },
  { id: 'bili_v1', url: 'https://www.bilibili.com/video/BV1QU4y1d71v/', shot: 'bili-bv1qu.png' },
  { id: 'bili_v2', url: 'https://www.bilibili.com/video/BV1yv411s7cD/', shot: 'bili-bv1yv.png' },
  { id: 'bili_v3', url: 'https://www.bilibili.com/video/BV1ai421D7eT/', shot: 'bili-bv1ai.png' },
];

function extractText(htmlish) {
  return String(htmlish || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}

async function scrape(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);
  const title = await page.title();
  const text = await page.evaluate(() => {
    const root = document.querySelector('main') || document.body;
    return (root?.innerText || '').slice(0, 12000);
  });
  // B站视频页尝试抓简介/标题
  const meta = await page.evaluate(() => {
    const h1 = document.querySelector('h1, .video-title, .title')?.innerText || '';
    const desc = document.querySelector('.desc-info-text, .basic-desc-info, #v_desc')?.innerText || '';
    const up = document.querySelector('.up-name, .username, .up-info .name')?.innerText || '';
    const cards = [...document.querySelectorAll('.bili-video-card, .video-list-item, .search-card')]
      .slice(0, 15)
      .map((el) => ({
        title: el.querySelector('.bili-video-card__info--tit, .title, a')?.innerText?.trim() || '',
        author: el.querySelector('.bili-video-card__info--author, .up-name')?.innerText?.trim() || '',
      }))
      .filter((x) => x.title);
    return { h1, desc: desc.slice(0, 2000), up, cards };
  });
  return { title, text: extractText(text), meta };
}

const browser = await chromium.launch({
  headless: true,
  channel: process.env.BROWSER_CHANNEL || undefined,
});
const context = await browser.newContext({
  locale: 'zh-CN',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
const result = { fetchedAt: new Date().toISOString(), items: [] };

for (const item of pages) {
  try {
    console.log('browse', item.id, item.url);
    const data = await scrape(page, item.url);
    await page.screenshot({ path: path.join(shots, item.shot), fullPage: false });
    result.items.push({ ...item, ok: true, ...data });
  } catch (e) {
    console.error('fail', item.id, e.message);
    result.items.push({ ...item, ok: false, error: e.message });
  }
}

fs.writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');
console.log('wrote', OUT);
await browser.close();
