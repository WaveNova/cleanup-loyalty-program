/**
 * Smoke test: open /my on iPhone viewport, capture all pageerrors and console errors.
 * Usage: npx tsx scripts/smoke-member.ts [URL]
 * Default URL: the feat/member-design Vercel preview
 */

import { chromium, devices } from 'playwright';

const BASE_URL =
  process.argv[2] ??
  'https://cleanup-loyalty-program-git-feat-member-design-wave-nova.vercel.app';

const TARGET = `${BASE_URL}/my`;

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 14'],
  });
  const page = await context.newPage();

  const pageErrors: string[]  = [];
  const consoleErrors: string[] = [];

  page.on('pageerror', err => {
    pageErrors.push(`[pageerror] ${err.message}\n${err.stack ?? ''}`);
  });

  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(`[console.error] ${msg.text()}`);
    }
  });

  console.log(`\nOpening: ${TARGET}\n`);

  const response = await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 30_000 });
  console.log(`HTTP status: ${response?.status()}`);

  // Wait a beat for any deferred errors
  await page.waitForTimeout(3000);

  const title   = await page.title();
  const content = await page.textContent('body');
  console.log(`Page title: ${title}`);
  console.log(`Body preview: ${content?.slice(0, 300)}`);

  if (pageErrors.length) {
    console.log('\n❌ PAGE ERRORS:');
    pageErrors.forEach(e => console.log(e));
  } else {
    console.log('\n✅ No pageerrors');
  }

  if (consoleErrors.length) {
    console.log('\n⚠️  CONSOLE ERRORS:');
    consoleErrors.forEach(e => console.log(e));
  } else {
    console.log('✅ No console errors');
  }

  await browser.close();

  if (pageErrors.length > 0) process.exit(1);
}

main().catch(e => { console.error(e); process.exit(1); });
