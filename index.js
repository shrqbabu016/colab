const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth to minimize Google bot detection
puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCookies(input) {
  if (!input) return [];
  const trimmed = input.trim();

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      return Object.entries(parsed).map(([name, value]) => ({
        name, value: String(value), domain: '.google.com', path: '/'
      }));
    } catch {}
  }

  const pairs = trimmed.split(/;\s*|\r?\n/);
  const cookies = [];
  for (const pair of pairs) {
    const cleanPair = pair.trim();
    if (!cleanPair || !cleanPair.includes('=')) continue;
    const eqIdx = cleanPair.indexOf('=');
    const name = cleanPair.substring(0, eqIdx).trim();
    const value = cleanPair.substring(eqIdx + 1).trim();

    if (name === 'OSID' || name === '__Secure-OSID') continue;

    if (name) {
      cookies.push({ name, value, domain: '.google.com', path: '/', secure: true });
    }
  }
  return cookies;
}

async function run() {
  const colabUrl = process.env.COLAB_URL;
  let cookiesInput = process.env.COLAB_COOKIES || '';
  const runAfterRestart = process.env.RUN_AFTER_RESTART === 'true';

  if (!colabUrl) {
    console.error('❌ Error: COLAB_URL environment variable is required.');
    process.exit(1);
  }

  const cookies = parseCookies(cookiesInput);
  
  console.log(`🚀 Starting Colab Auto Restarter...`);
  
  // EK HI BROWSER LAUNCH KAREIN (With User Data Dir)
  const browser = await puppeteer.launch({
    headless: true, // ya 'new'
    userDataDir: './puppeteer_profile', // Profile save hogi
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1400,900'
    ],
    defaultViewport: { width: 1400, height: 900 }
  });

  try {
    const page = await browser.newPage();

    // Set User-Agent
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Inject Cookies (Agar fresh string aayi hai)
    if (cookies.length > 0) {
      console.log(`🍪 Injecting ${cookies.length} cookies...`);
      for (const cookie of cookies) {
        try {
          const clean = { name: cookie.name, value: cookie.value, path: cookie.path || '/' };
          if (!cookie.name.startsWith('__Host-')) clean.domain = '.google.com';
          clean.secure = true;
          await page.setCookie(clean);
        } catch (e) {}
      }
      console.log(`✅ Cookies injected!`);
      
      // Cookie ek bar load hone ke bad env variable clear nahi hogi, par browser ab unhe yaad rakhega
    } else {
      console.log('ℹ️ Using previously saved browser profile from cache (No new cookies string).');
    }

    console.log('🌐 Navigating to Colab notebook...');
    await page.goto(colabUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(5000);

    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      console.error('❌ Redirected to Google Sign-in page! Cookies are expired or Google blocked the IP.');
      await page.screenshot({ path: 'login-failed.png', fullPage: true });
      process.exit(1);
    }

    console.log('✅ Successfully reached Colab! Waiting for UI...');
    await page.waitForSelector('colab-menu-bar, #main-content', { timeout: 35000 }).catch(()=>console.log('UI wait timeout, proceeding...'));
    await page.screenshot({ path: 'colab-loaded.png' });

    // --- YAHAN SE AAPKA BAAKI KA RUN/RESTART LOGIC HOGA ---
    console.log('▶️ Running restart logic...');
    
    // Backup keyboard shortcut for Run All
    if (runAfterRestart) {
      console.log('⌨️ Sending backup "Run All" (Ctrl+F9)...');
      await page.focus('body');
      await page.keyboard.down('Control');
      await page.keyboard.press('F9');
      await page.keyboard.up('Control');
      await sleep(2000);
    }

    await sleep(20000); // Wait for colab to execute completely
    
  } catch (error) {
    console.error('❌ Error during execution:', error);
    process.exit(1);
  } finally {
    await browser.close();
    console.log('🏁 Browser closed. Profile saved.');
  }
}

run();
