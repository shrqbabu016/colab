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
        path: '/',
        secure: true
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

          // Chromium strictly requires secure: true for __Secure- and __Host- cookies
          if (cookie.name.startsWith('__Secure-') || cookie.name.startsWith('__Host-')) {
            clean.secure = true;
          } else if (typeof cookie.secure === 'boolean') {
            clean.secure = cookie.secure;
          } else {
            clean.secure = true;
          }

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

    // Also attach Cookie header directly to outgoing HTTP requests
    if (cookiesInput && typeof cookiesInput === 'string' && cookiesInput.includes('=')) {
      try {
        await page.setExtraHTTPHeaders({
          'Cookie': cookiesInput.trim()
        });
      } catch {}
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
    try {
      await page.waitForFunction(
        () => document.querySelector('colab-menu-bar') ||
              document.querySelector('#main-content') ||
              document.querySelector('colab-notebook') ||
              document.querySelector('colab-connect-button') ||
              document.querySelector('#runtime-menu-button'),
        { timeout: 35000 }
      );
    } catch {
      console.log('⚠️ Colab interface elements taking longer than usual, proceeding with fallback...');
    }

    await sleep(4000);
    await page.screenshot({ path: 'colab-loaded.png' });
    console.log('📸 Saved colab-loaded.png');

    // Helper: Find element across regular DOM and Shadow Roots
    async function queryDeep(selector) {
      return await page.evaluate((sel) => {
        function search(root) {
          const direct = root.querySelector(sel);
          if (direct) return true;
          const all = root.querySelectorAll('*');
          for (const el of all) {
            if (el.shadowRoot) {
              const res = search(el.shadowRoot);
              if (res) return true;
            }
          }
          return false;
        }
        return search(document);
      }, selector);
    }

    // Helper: Handle any open Colab modal/popup (Run anyway, Restart confirmation, etc.)
    async function handleAllModals() {
      return await page.evaluate(() => {
        function findInShadowsAll(selector, root = document) {
          let results = Array.from(root.querySelectorAll(selector));
          const all = root.querySelectorAll('*');
          for (const item of all) {
            if (item.shadowRoot) {
              results = results.concat(findInShadowsAll(selector, item.shadowRoot));
            }
          }
          return results;
        }

        let handled = false;
        const buttons = findInShadowsAll('button, mwc-button, paper-button, #ok');
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          if (
            text === 'run anyway' ||
            text === 'restart' ||
            text === 'yes' ||
            text.includes('run anyway') ||
            text.includes('restart session') ||
            btn.id === 'ok'
          ) {
            btn.click();
            handled = true;
          }
        }
        return handled;
      });
    }

    // Step 1: Connect if not connected
    console.log('🔍 Checking Colab connection status...');
    try {
      const clickedConnect = await page.evaluate(() => {
        function findInShadows(selector, root = document) {
          let el = root.querySelector(selector);
          if (el) return el;
          const all = root.querySelectorAll('*');
          for (const item of all) {
            if (item.shadowRoot) {
              const found = findInShadows(selector, item.shadowRoot);
              if (found) return found;
            }
          }
          return null;
        }

        const connectEl = findInShadows('colab-connect-button') || findInShadows('#connect');
        if (connectEl) {
          const btn = connectEl.shadowRoot ? (connectEl.shadowRoot.querySelector('button, mwc-button') || connectEl) : connectEl;
          const text = (btn.innerText || btn.textContent || '').toLowerCase();
          if (text.includes('connect')) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      if (clickedConnect) {
        console.log('⚡ Clicked Connect button. Waiting 8s for initialization...');
        await sleep(8000);
      } else {
        console.log('ℹ️ Already connected or connect button not requiring action.');
      }
    } catch (e) {
      console.log('Notice checking connect button:', e.message);
    }

    // Dismiss any initial warning modals
    await handleAllModals();

    // Step 2: Trigger "Restart Session and Run All" or "Restart"
    console.log('🔄 Triggering Colab Restart & Run...');
    let restartTriggered = false;

    // Strategy 1: Colab's native JS API
    try {
      const apiAction = await page.evaluate(() => {
        if (window.colab && window.colab.global && window.colab.global.notebook) {
          if (typeof window.colab.global.notebook.restartAndRunAll === 'function') {
            window.colab.global.notebook.restartAndRunAll();
            return 'restartAndRunAll';
          }
          if (window.colab.global.notebook.kernel && typeof window.colab.global.notebook.kernel.restart === 'function') {
            window.colab.global.notebook.kernel.restart();
            return 'kernel.restart';
          }
        }
        return null;
      });

      if (apiAction) {
        console.log(`✅ Triggered via Colab Native API: ${apiAction}`);
        restartTriggered = true;
      }
    } catch (e) {}

    // Strategy 2: Shadow DOM piercing to click Runtime Menu
    if (!restartTriggered) {
      try {
        console.log('📂 Searching Runtime menu through Shadow DOM...');
        const clickedMenu = await page.evaluate(() => {
          function findDeep(predicate, root = document) {
            if (predicate(root)) return root;
            if (root.shadowRoot) {
              const found = findDeep(predicate, root.shadowRoot);
              if (found) return found;
            }
            for (const child of root.children || []) {
              const found = findDeep(predicate, child);
              if (found) return found;
            }
            return null;
          }

          const runtimeBtn = findDeep((el) => {
            return (
              el.id === 'runtime-menu-button' ||
              (el.getAttribute && el.getAttribute('role') === 'menuitem' && (el.innerText || '').trim() === 'Runtime') ||
              (el.tagName === 'DIV' && (el.innerText || '').trim() === 'Runtime')
            );
          });

          if (runtimeBtn) {
            runtimeBtn.click();
            return true;
          }
          return false;
        });

        if (clickedMenu) {
          console.log('📂 Opened Runtime menu. Looking for Restart / Run all option...');
          await sleep(1500);

          const menuAction = await page.evaluate(() => {
            const menuItems = Array.from(document.querySelectorAll('.goog-menuitem, [role="menuitem"], mwc-list-item'));
            // Prefer "Restart session and run all"
            for (const item of menuItems) {
              const text = (item.innerText || '').toLowerCase();
              if (text.includes('restart session and run all') || text.includes('restart and run all')) {
                item.click();
                return 'restart_and_run_all';
              }
            }
            // Fallback to "Restart session"
            for (const item of menuItems) {
              const text = (item.innerText || '').toLowerCase();
              if (text.includes('restart session') || text.includes('restart runtime')) {
                item.click();
                return 'restart_session';
              }
            }
            return null;
          });

          if (menuAction) {
            console.log(`✅ Selected menu item: ${menuAction}`);
            restartTriggered = true;
          }
        }
      } catch (e) {
        console.log('Notice on menu traversal:', e.message);
      }
    }

    // Strategy 3: Keyboard shortcuts fallback
    if (!restartTriggered) {
      console.log('⌨️ Dispatching Colab restart keyboard shortcut (Ctrl+M .)...');
      await page.evaluate(() => {
        const ctrlM = new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', keyCode: 77, ctrlKey: true, bubbles: true });
        document.dispatchEvent(ctrlM);
        const period = new KeyboardEvent('keydown', { key: '.', code: 'Period', keyCode: 190, bubbles: true });
        document.dispatchEvent(period);
      });
      await sleep(1500);
    }

    // Handle restart confirmation dialog
    await sleep(2000);
    const modalConfirmed = await handleAllModals();
    if (modalConfirmed) {
      console.log('✅ Confirmed restart modal dialog.');
    }

    // Step 3: Trigger "Run All" (Ctrl+F9)
    if (runAfterRestart) {
      console.log('▶️ Waiting 8s for kernel restart to settle before Run All...');
      await sleep(8000);

      console.log('▶️ Sending "Run All" (Ctrl+F9) to document...');
      await page.evaluate(() => {
        // Direct event dispatch to both window and document
        const f9 = new KeyboardEvent('keydown', {
          key: 'F9',
          code: 'F9',
          keyCode: 120,
          which: 120,
          ctrlKey: true,
          metaKey: true,
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(f9);
        window.dispatchEvent(f9);

        // Also try Colab notebook runAll if present
        if (window.colab?.global?.notebook?.runAll) {
          window.colab.global.notebook.runAll();
        }
      });

      // Also trigger via Puppeteer keyboard as backup
      try {
        await page.keyboard.down('Control');
        await page.keyboard.press('F9');
        await page.keyboard.up('Control');
      } catch {}

      await sleep(2000);
      // Auto-click "Run anyway" if Colab shows untrusted notebook warning
      await handleAllModals();
    }

    // Step 4: Monitor Execution & Search for Active Ngrok Tunnel URL
    console.log('⏳ Monitoring notebook execution and waiting for Ngrok tunnel...');
    const maxWaitMs = 120000; // 2 minutes max
    const pollIntervalMs = 5000;
    const startTime = Date.now();
    let detectedNgrok = null;

    while (Date.now() - startTime < maxWaitMs) {
      await sleep(pollIntervalMs);

      // Continuously handle any warning or reconnect dialogs
      await handleAllModals();

      // Check for Ngrok URL in page text and cell output elements
      const ngrokUrl = await page.evaluate(() => {
        const text = document.body.innerText || '';
        const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.(ngrok-free\.app|ngrok\.io|ngrok\.app)[^\s'"]*/i);
        return match ? match[0] : null;
      });

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      if (ngrokUrl) {
        detectedNgrok = ngrokUrl;
        console.log('\n==================================================');
        console.log(`🎉 NGROK TUNNEL IS ACTIVE AND ONLINE!`);
        console.log(`🔗 URL: ${detectedNgrok}`);
        console.log('==================================================\n');
        // Let it run for 15s more to stabilize the background process
        await sleep(15000);
        break;
      } else {
        console.log(`⏱️ Notebook is running... (${elapsed}s elapsed, checking for ngrok url...)`);
      }
    }

    if (!detectedNgrok) {
      console.log('ℹ️ Wait window completed. Notebook execution started and running in background.');
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
