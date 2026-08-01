import { chromium } from 'playwright-core';
const exe = '/home/user/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args:['--no-sandbox','--disable-gpu'] });
const shots = [
  { url:'https://ivxholding.com', name:'landing-desktop', viewport:{width:1440,height:900} },
  { url:'https://ivxholding.com', name:'landing-android', viewport:{width:412,height:915}, ua:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' },
  { url:'https://ivxholding.com', name:'landing-ios', viewport:{width:390,height:844}, ua:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1' },
  { url:'https://chat.ivxholding.com', name:'chat-desktop', viewport:{width:1440,height:900} },
  { url:'https://chat.ivxholding.com', name:'chat-mobile', viewport:{width:412,height:915}, ua:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36' },
];
const out = [];
for (const s of shots) {
  const ctx = await browser.newContext({ viewport:s.viewport, userAgent:s.ua });
  const page = await ctx.newPage();
  await page.goto(s.url, { waitUntil:'networkidle', timeout:30000 }).catch(()=>{});
  await page.waitForTimeout(2500);
  const path = `screenshots/qa-final-2026-07-05/${s.name}.png`;
  await page.screenshot({ path, fullPage:false });
  const title = await page.title();
  const bodyText = (await page.evaluate(()=>document.body?.innerText?.slice(0,600)||'')).replace(/\s+/g,' ').slice(0,500);
  out.push({ name:s.name, title, bodyText, path });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(out,null,2));
