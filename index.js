const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth to minimize Google bot detection
puppeteer.use(StealthPlugin());

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper to parse cookies from either Cookie Header string or JSON
function parseCookies(input) {
  if (!input) return [];
  const trimmed = input.trim();

  // 1. If it's JSON format
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      return Object.entries(parsed).map(([name, value]) => ({
        name,
        value: String(value),
        domain: '.google.com',
        path: '/'
      }));
    } catch {}
  }

  // 2. If it's a Cookie String: "name1=value1; name2=value2; ..."
  const pairs = trimmed.split(/;\s*|\r?\n/);
  const cookies = [];
  for (const pair of pairs) {
    const cleanPair = pair.trim();
    if (!cleanPair || !cleanPair.includes('=')) continue;
    const eqIdx = cleanPair.indexOf('=');
    const name = cleanPair.substring(0, eqIdx).trim();
    const value = cleanPair.substring(eqIdx + 1).trim();

    // Skip origin-bound cookies from other subdomains (like myaccount)
    if (name === 'OSID' || name === '__Secure-OSID') {
      continue;
    }

    if (name) {
      cookies.push({
        name,
        value,
        domain: '.google.com',
        path: '/'
      });
    }
  }
  return cookies;
}

async function run() {
  const colabUrl = process.env.COLAB_URL;
  let cookiesInput = process.env.COLAB_COOKIES || '';
  const runAfterRestart = process.env.RUN_AFTER_RESTART === 'true';

  // Support reading from local file if cookies.txt or cookies.json exists
  if (!cookiesInput) {
    if (fs.existsSync('cookies.txt')) {
      cookiesInput = fs.readFileSync('cookies.txt', 'utf-8');
    } else if (fs.existsSync('cookies.json')) {
      cookiesInput = fs.readFileSync('cookies.json', 'utf-8');
    }
  }

  if (!colabUrl) {
    console.error('❌ Error: COLAB_URL environment variable is required.');
    process.exit(1);
  }

  const cookies = parseCookies(cookiesInput);
  if (cookies.length === 0) {
    console.warn('⚠️ Warning: No cookies provided. Google authentication may fail.');
  } else {
    console.log(`🍪 Successfully parsed ${cookies.length} cookies from string/input.`);
    const hasSID = cookies.some(c => c.name === 'SID');
    const hasHSID = cookies.some(c => c.name === 'HSID');
    if (!hasSID || !hasHSID) {
      console.warn(`⚠️ Warning: "SID" or "HSID" cookie is missing in your string! Google often shows "Signed out on a different tab" when SID is missing.`);
    }
  }

  console.log(`🚀 Starting Colab Auto Restarter...`);
  console.log(`🔗 Target URL: ${colabUrl}`);

  const browser = await puppeteer.launch({
    headless: 'new',
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
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
    );

    // Sanitize and set cookies individually
    if (cookies.length > 0) {
      console.log(`🍪 Injecting ${cookies.length} cookies...`);
      let successCount = 0;
      for (const cookie of cookies) {
        try {
          const clean = {
            name: cookie.name,
            value: cookie.value,
            path: cookie.path || '/'
          };

          // RFC 6265: Cookies starting with __Host- MUST NOT have a domain attribute
          if (!cookie.name.startsWith('__Host-') && cookie.domain) {
            clean.domain = cookie.domain;
          }

          if (typeof cookie.secure === 'boolean') clean.secure = cookie.secure;
          if (typeof cookie.httpOnly === 'boolean') clean.httpOnly = cookie.httpOnly;
          if (cookie.expirationDate) clean.expires = cookie.expirationDate;

          if (cookie.sameSite) {
            const s = String(cookie.sameSite).toLowerCase();
            if (s === 'lax') clean.sameSite = 'Lax';
            else if (s === 'strict') clean.sameSite = 'Strict';
            else if (s === 'none' || s === 'no_restriction') clean.sameSite = 'None';
          }

          await page.setCookie(clean);
          successCount++;
        } catch (err) {
          // If setting with domain failed, try without domain
          try {
            await page.setCookie({
              name: cookie.name,
              value: cookie.value,
              url: 'https://colab.research.google.com'
            });
            successCount++;
          } catch {}
        }
      }
      console.log(`✅ Successfully injected ${successCount}/${cookies.length} cookies.`);
    }

    console.log('🌐 Navigating to Colab notebook...');
    await page.goto(colabUrl, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(4000);

    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      console.error('❌ Redirected to Google Sign-in page! Cookies are expired or missing.');
      await page.screenshot({ path: 'login-failed.png', fullPage: true });
      process.exit(1);
    }

    console.log('⏳ Waiting for Colab UI to initialize...');
    // Wait for Colab interface elements
    try {
      await page.waitForFunction(
        () => document.querySelector('#runtime-menu-button') ||
              document.querySelector('colab-connect-button') ||
              document.querySelector('#connect'),
        { timeout: 30000 }
      );
    } catch {
      console.log('⚠️ Standard selectors not found yet, continuing with generic fallback...');
    }

    await sleep(3000);
    await page.screenshot({ path: 'colab-loaded.png' });

    // Step 1: Connect if not connected
    console.log('🔍 Checking Colab connection status...');
    const connectButton = await page.$('colab-connect-button, #connect');
    if (connectButton) {
      const connectText = await page.evaluate(el => el.innerText || '', connectButton);
      console.log(`Current Connect Button Status: "${connectText.trim()}"`);
      if (connectText.toLowerCase().includes('connect')) {
        console.log('⚡ Clicking Connect button...');
        await connectButton.click();
        await sleep(5000);
      }
    }

    // Step 2: Trigger Restart Session
    console.log('🔄 Triggering Restart Session...');
    let restartTriggered = false;

    // Method A: Click "Runtime" menu then "Restart session"
    try {
      const runtimeMenu = await page.$('#runtime-menu-button');
      if (runtimeMenu) {
        console.log('📂 Clicking Runtime menu...');
        await runtimeMenu.click();
        await sleep(1000);

        // Find "Restart session" or "Restart runtime" in the menu
        restartTriggered = await page.evaluate(() => {
          const menuItems = Array.from(document.querySelectorAll('.goog-menuitem, [role="menuitem"], mwc-list-item'));
          for (const item of menuItems) {
            const text = (item.innerText || '').toLowerCase();
            if (text.includes('restart session') || text.includes('restart runtime')) {
              item.click();
              return true;
            }
          }
          return false;
        });

        if (restartTriggered) {
          console.log('✅ Clicked "Restart session" from Runtime menu.');
        }
      }
    } catch (e) {
      console.log('Notice: Menu click attempt encountered an issue:', e.message);
    }

    // Method B: Keyboard Shortcut fallback (Ctrl+M followed by .)
    if (!restartTriggered) {
      console.log('⌨️ Trying Colab keyboard shortcut: Ctrl+M then Period (.)');
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyM');
      await page.keyboard.up('Control');
      await sleep(300);
      await page.keyboard.press('Period');
      await sleep(1500);
    }

    // Step 3: Handle Confirmation Dialog ("Restart session?" modal)
    console.log('❓ Looking for restart confirmation modal...');
    await sleep(2000);

    const confirmed = await page.evaluate(() => {
      // Look for dialog buttons with Yes/Restart/OK
      const buttons = Array.from(document.querySelectorAll('mwc-button, paper-button, button, #ok'));
      for (const btn of buttons) {
        const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
        if (text === 'yes' || text === 'restart' || text.includes('restart session') || btn.id === 'ok') {
          btn.click();
          return true;
        }
      }
      return false;
    });

    if (confirmed) {
      console.log('✅ Confirmed restart in modal dialog!');
    } else {
      console.log('ℹ️ No confirmation popup needed or already handled.');
    }

    await sleep(5000);
    console.log('🎉 Colab session successfully restarted!');

    // Optional Step 4: Run all cells if RUN_AFTER_RESTART is set to true
    if (runAfterRestart) {
      console.log('▶️ RUN_AFTER_RESTART is enabled. Triggering "Run all" (Ctrl+F9)...');
      await page.keyboard.down('Control');
      await page.keyboard.press('F9');
      await page.keyboard.up('Control');
      await sleep(3000);
      console.log('✅ "Run all" command sent.');
    }

    await page.screenshot({ path: 'colab-restarted.png' });
    console.log('📸 Saved final screenshot as colab-restarted.png');

  } catch (error) {
    console.error('❌ Error during execution:', error);
    try {
      await page.screenshot({ path: 'error-screenshot.png' });
      console.log('📸 Saved error screenshot as error-screenshot.png');
    } catch {}
    process.exit(1);
  } finally {
    await browser.close();
    console.log('🏁 Browser closed. Done!');
  }
}

run();
