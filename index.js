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

    // Listen for any popup authorization windows (e.g., Google Drive consent)
    browser.on('targetcreated', async (target) => {
      try {
        if (target.type() === 'page') {
          const newPage = await target.page();
          if (!newPage) return;
          console.log(`🔗 Popup window opened: ${newPage.url()}`);
          await sleep(3000);
          await newPage.evaluate(() => {
            const acc = document.querySelector('[data-identifier], [data-email], [role="link"], button');
            if (acc) acc.click();
          }).catch(() => {});
          await sleep(2000);
          await newPage.evaluate(() => {
            const allowBtn = Array.from(document.querySelectorAll('button, #submit_approve_access')).find(b => {
              const t = (b.innerText || '').toLowerCase();
              return t.includes('allow') || t.includes('continue') || b.id === 'submit_approve_access';
            });
            if (allowBtn) allowBtn.click();
          }).catch(() => {});
        }
      } catch (e) {
        console.log('Notice in popup listener:', e.message);
      }
    });

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

    // Helper: Handle any open Colab modal/popup (Run anyway, Restart confirmation, Google Drive, etc.)
    async function handleAllModals() {
      const handledInPage = await page.evaluate(() => {
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
        const buttons = findInShadowsAll('button, mwc-button, paper-button, #ok, .colab-dialog button, [slot="primaryAction"]');
        for (const btn of buttons) {
          const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
          if (
            text === 'run anyway' ||
            text === 'restart' ||
            text === 'yes' ||
            text.includes('run anyway') ||
            text.includes('restart session') ||
            text.includes('connect to google drive') ||
            text.includes('google drive') ||
            text.includes('permit') ||
            btn.id === 'ok'
          ) {
            try {
              if (btn.shadowRoot && btn.shadowRoot.querySelector('button')) {
                btn.shadowRoot.querySelector('button').click();
              }
              btn.click();
              btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              handled = true;
            } catch (_) {}
          }
        }
        return handled;
      });

      // Also try physical mouse click on coordinates if a modal is visible
      try {
        const box = await page.evaluate(() => {
          function findInShadowsAll(selector, root = document) {
            let results = Array.from(root.querySelectorAll(selector));
            for (const item of root.querySelectorAll('*')) {
              if (item.shadowRoot) {
                results = results.concat(findInShadowsAll(selector, item.shadowRoot));
              }
            }
            return results;
          }

          const candidates = findInShadowsAll('mwc-button, button, #ok, [slot="primaryAction"]');
          for (const el of candidates) {
            const text = (el.innerText || el.textContent || '').toLowerCase();
            if (text.includes('connect to google drive') || text.includes('google drive')) {
              const rect = el.getBoundingClientRect();
              if (rect.width > 20 && rect.height > 10) {
                return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: text.trim() };
              }
            }
          }
          return null;
        });

        if (box) {
          console.log(`👆 Physically clicking modal button "${box.text}" at (${Math.round(box.x)}, ${Math.round(box.y)})...`);
          await page.mouse.click(box.x, box.y);
          return true;
        }
      } catch (_) {}

      return handledInPage;
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

    // Helper: Open Runtime Menu and click target item
    async function clickRuntimeMenuItem(targetNames) {
      return await page.evaluate((names) => {
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

        // 1. Locate and click Runtime top-level menu button
        const runtimeBtn = findDeep((el) => {
          return (
            el.id === 'runtime-menu-button' ||
            (el.getAttribute && el.getAttribute('role') === 'menuitem' && (el.innerText || '').trim() === 'Runtime') ||
            (el.tagName === 'DIV' && (el.innerText || '').trim() === 'Runtime')
          );
        });

        if (!runtimeBtn) return null;
        runtimeBtn.click();

        // 2. Search opened menu items
        const menuItems = Array.from(document.querySelectorAll('.goog-menuitem, [role="menuitem"], mwc-list-item'));
        for (const name of names) {
          for (const item of menuItems) {
            const text = (item.innerText || item.textContent || '').trim().toLowerCase();
            if (text.includes(name.toLowerCase())) {
              item.click();
              return text;
            }
          }
        }
        return 'opened_menu_only';
      }, targetNames);
    }

    // Step 2: Trigger Restart and Run All
    console.log('🔄 Triggering Colab Restart and Run All...');
    let executedAction = null;

    // Attempt 1: Click "Restart session and run all" directly from Runtime menu
    try {
      console.log('📂 Attempting to click "Restart session and run all" via Runtime menu...');
      const clicked = await clickRuntimeMenuItem([
        'restart session and run all',
        'restart and run all',
        'restart session & run all'
      ]);
      if (clicked && clicked !== 'opened_menu_only') {
        executedAction = clicked;
        console.log(`✅ Selected menu option: "${executedAction}"`);
      }
    } catch (e) {
      console.log('Notice on menu attempt 1:', e.message);
    }

    // Attempt 2: If "Restart and run all" not directly found, trigger Restart Session then Run All
    if (!executedAction) {
      try {
        console.log('📂 Trying "Restart session" from Runtime menu...');
        const restartClicked = await clickRuntimeMenuItem([
          'restart session',
          'restart runtime'
        ]);
        if (restartClicked && restartClicked !== 'opened_menu_only') {
          console.log(`✅ Clicked "${restartClicked}".`);
          executedAction = restartClicked;
        }
      } catch (e) {}

      // Fallback: API restart if menu wasn't clicked
      if (!executedAction) {
        try {
          const apiRestart = await page.evaluate(() => {
            if (window.colab?.global?.notebook?.kernel?.restart) {
              window.colab.global.notebook.kernel.restart();
              return true;
            }
            return false;
          });
          if (apiRestart) console.log('✅ Triggered kernel restart via Colab API.');
        } catch (e) {}
      }

      // Handle confirmation modal
      await sleep(2500);
      await handleAllModals();

      // Now trigger Run All
      console.log('▶️ Waiting 6s for kernel restart to initialize...');
      await sleep(6000);

      console.log('▶️ Triggering "Run all" from Runtime menu...');
      try {
        const runAllClicked = await clickRuntimeMenuItem(['run all']);
        if (runAllClicked && runAllClicked !== 'opened_menu_only') {
          console.log(`✅ Clicked "${runAllClicked}" from Runtime menu.`);
          executedAction = 'run_all';
        }
      } catch (e) {}
    }

    // Always handle any modal after trigger (Confirm restart / "Run anyway")
    await sleep(2500);
    const confirmedAny = await handleAllModals();
    if (confirmedAny) {
      console.log('✅ Confirmed modal dialog (Restart / Run anyway).');
    }

    // Backup keyboard shortcut for Run All
    if (runAfterRestart) {
      console.log('⌨️ Sending backup "Run All" (Ctrl+F9)...');
      try {
        await page.focus('body');
        await page.keyboard.down('Control');
        await page.keyboard.press('F9');
        await page.keyboard.up('Control');
      } catch {}
      await sleep(2000);
      await handleAllModals();
    }

    // Step 4: Monitor Execution & Search for Active Ngrok Tunnel URL across document AND IFRAMES
    console.log('⏳ Monitoring notebook execution and waiting for Ngrok tunnel...');
    const maxWaitMs = 150000; // 2.5 minutes max
    const pollIntervalMs = 5000;
    const startTime = Date.now();
    let detectedNgrok = null;

    while (Date.now() - startTime < maxWaitMs) {
      await sleep(pollIntervalMs);

      // Continuously handle any warning or reconnect dialogs
      await handleAllModals();

      // Check if Colab disconnected and needs reconnecting
      try {
        await page.evaluate(() => {
          function findInShadows(selector, root = document) {
            let el = root.querySelector(selector);
            if (el) return el;
            for (const item of root.querySelectorAll('*')) {
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
            if (text.includes('reconnect') || text === 'connect') {
              btn.click();
            }
          }
        });
      } catch (_) {}

      // Check for Ngrok URL in main page AND all child iframes (where Colab outputs live!)
      let combinedContent = '';
      try {
        combinedContent += await page.evaluate(() => document.body ? document.body.innerText : '');
      } catch {}

      const frames = page.frames();
      for (const frame of frames) {
        try {
          const frameText = await frame.evaluate(() => document.body ? document.body.innerText : '');
          if (frameText) combinedContent += '\n' + frameText;
        } catch {}
      }

      // Also check if notebook has active execution indicator
      const isExecuting = await page.evaluate(() => {
        const executing = document.querySelector('colab-run-button[aria-label*="Executing"], [aria-label*="Interrupt execution"], #interrupt-execution');
        return Boolean(executing);
      });

      const match = combinedContent.match(/https:\/\/[a-zA-Z0-9-]+\.(?:ngrok-free\.(?:dev|app)|ngrok\.(?:io|app|dev))[^\s'"<>]*/i) ||
                    combinedContent.match(/https:\/\/[a-zA-Z0-9.-]+\.ngrok[a-zA-Z0-9.-]*/i);
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      if (match) {
        detectedNgrok = match[0];
        console.log('\n==================================================');
        console.log(`🎉 NGROK TUNNEL IS ACTIVE AND ONLINE!`);
        console.log(`🔗 URL: ${detectedNgrok}`);
        console.log('==================================================\n');
        // Let it run for 20s more so tunnel stays fully online
        await sleep(20000);
        break;
      } else {
        const execStatus = isExecuting ? ' [⚡ Cells executing]' : '';
        console.log(`⏱️ Notebook is running... (${elapsed}s elapsed${execStatus}, checking for ngrok url...)`);
      }
    }

    if (!detectedNgrok) {
      console.log('ℹ️ Wait window completed. Notebook execution running in background.');
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
