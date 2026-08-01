import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';

const OUT = '/home/user/rork-app/screenshots/qa-2026-07-05';
const results: Record<string, string> = {};

async function shoot(name: string, page: any, url: string, opts: { width?: number; height?: number; wait?: number } = {}) {
  const { width = 1440, height = 900, wait = 2500 } = opts;
  try {
    await page.setViewportSize({ width, height });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(wait);
    const path = `${OUT}/${name}.png`;
    await page.screenshot({ path, fullPage: false });
    results[name] = `OK ${path}`;
  } catch (e: any) {
    results[name] = `FAIL ${e?.message?.slice(0, 120)}`;
  }
}

(async () => {
  const exec = process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({ executablePath: exec, headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // 1. Landing desktop
  await shoot('01-landing-desktop', page, 'https://ivxholding.com', { width: 1440, height: 900, wait: 3000 });

  // 2. Landing mobile (Android-style viewport)
  await shoot('02-landing-android', page, 'https://ivxholding.com', { width: 412, height: 915, wait: 2500 });

  // 3. Landing mobile (iOS-style viewport)
  await shoot('03-landing-ios', page, 'https://ivxholding.com', { width: 393, height: 852, wait: 2500 });

  // 4. Chat desktop
  await shoot('04-chat-desktop', page, 'https://chat.ivxholding.com', { width: 1440, height: 900, wait: 3500 });

  // 5. Chat mobile
  await shoot('05-chat-mobile', page, 'https://chat.ivxholding.com', { width: 393, height: 852, wait: 3500 });

  // 6. Capture DOM title + any visible text for evidence
  const dom: Record<string, any> = {};
  for (const u of ['https://ivxholding.com', 'https://chat.ivxholding.com']) {
    await page.goto(u, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    dom[u] = {
      title: await page.title().catch(() => 'err'),
      bodyText: (await page.evaluate(() => document.body?.innerText?.slice(0, 400)).catch(() => 'err')),
      h1: await page.evaluate(() => document.querySelector('h1')?.innerText?.slice(0,200)).catch(() => null),
    };
  }
  writeFileSync(`${OUT}/dom-evidence.json`, JSON.stringify(dom, null, 2));

  // 7. Try to interact with chat: find input, type, send
  let chatSend = 'no-input-found';
  let aiReply = 'no-reply';
  try {
    await page.goto('https://chat.ivxholding.com', { waitUntil: 'networkidle', timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(2500);
    const input = await page.$('textarea, input[type="text"], input[type="email"], input[type="password"]');
    if (input) {
      const placeholder = await input.getAttribute('placeholder').catch(()=>null);
      chatSend = `input-found placeholder="${placeholder}"`;
      // try typing
      await input.fill('QA test from Playwright 2026-07-05').catch(()=>{});
      await page.screenshot({ path: `${OUT}/06-chat-typed.png` });
      // try send
      const sendBtn = await page.$('button[type="submit"], button:has-text("Send"), button:has-text("send")');
      if (sendBtn) {
        await sendBtn.click().catch(()=>{});
        await page.waitForTimeout(4000);
        await page.screenshot({ path: `${OUT}/07-chat-after-send.png` });
        aiReply = 'send-clicked-screenshot-captured';
      } else {
        await page.keyboard.press('Enter').catch(()=>{});
        await page.waitForTimeout(4000);
        await page.screenshot({ path: `${OUT}/07-chat-after-send.png` });
        aiReply = 'enter-pressed-screenshot-captured';
      }
    }
  } catch (e: any) {
    chatSend = `error ${e?.message?.slice(0,100)}`;
  }
  writeFileSync(`${OUT}/chat-interaction.json`, JSON.stringify({ chatSend, aiReply }, null, 2));

  await browser.close();
  console.log(JSON.stringify({ results, chatSend, aiReply }, null, 2));
})();
