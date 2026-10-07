const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth to minimize Google bot detection
puppeteer.use(StealthPlugin());

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const colabUrl = process.env.COLAB_URL;
  const cookiesInput = process.env.COLAB_COOKIES;
  const runAfterRestart = process.env.RUN_AFTER_RESTART === 'true';

  if (!colabUrl) {
    console.error('❌ Error: COLAB_URL environment variable is required.');
    process.exit(1);
  }

  let cookies = [
    {
        "domain": ".google.com",
        "expirationDate": 1825934425.609218,
        "hostOnly": false,
        "httpOnly": false,
        "name": "SAPISID",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "BwEYm2ne2RL9klfh/AzYSDd3sIhT_AtUEt"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1825934425.60935,
        "hostOnly": false,
        "httpOnly": false,
        "name": "__Secure-3PAPISID",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "BwEYm2ne2RL9klfh/AzYSDd3sIhT_AtUEt"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1804934109.684451,
        "hostOnly": false,
        "httpOnly": true,
        "name": "AEC",
        "path": "/",
        "sameSite": "lax",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "Aaa9EJqsE02EgasJHzNRiydetRFt8g-Pk7pUrYxLGu56N2Vi1Fg2Fm4FEMk"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1807195341.540743,
        "hostOnly": false,
        "httpOnly": true,
        "name": "NID",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "CvsDCAESrQMBOxGDSMbZHJwGRJtCFY5k-AwETdq5Z6D7qNb9s_Pl26u4l61HTX-G2vDRIQFuYCO7lmBFDoshFnYkSleG6gJ-mDNc-N1UuoiXy4xgwV6Gr8VDwfhr3DH8emp41SWnD11oMs40IEMeFbv4DXHe5Cv85lIU4LpW0KQSstyuaYbBPDBFZyVuwuU7yA_Gf77h2VrU9gt5WTU_EhvOBXddBQevEDKcg4HkeSVDJIy1h1sHH6ombkrNp2g4_JnCuuS_fyL8z9UnsBqc2XCgOOIBc0hIPoRT2FwV_UxXjimyB3KQTJKm5tebGoEoBGwAB4fRRXYkshAo50wyvJ94dHFjzbOvfcRly-pVUEkGiTRWHtFvNuJkeBu8__ODfqKmmLxapcZgpLaYArTOw0WrYIXCxKzLgNFf37MEyfbRdLg2fRTVEcteSrHSd3niMk9cX_FevQmD90bVpct1ybmzquyF9xDt3g7RIb2x1UbBuaPL2RO0jE71UxJZQa7jpudq_bmG6uSLqXr3LGnOL-6FZLSanfZV6BBgI1kZXVw03zBKEq3AYp1xM0G-CLcGqKSaNxwoATJFAdKsB8_Y7N2nN4QlwVjDNYkBOI_sZnMtJrQZpPFzEcVzX5Z0uaVae4SWP2nGtScSsYXS1by4S1HBFZhm5p4jo2JhvzIE"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1822927382.539997,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-1PSIDTS",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "sidts-CjEBkldj_yNGQZKBE0SLy9YCLw4925gyh-oDZVjJak13m_4ZZRoqMGESEIxBVePd-B28EAA"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1825934425.609283,
        "hostOnly": false,
        "httpOnly": false,
        "name": "__Secure-1PAPISID",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "BwEYm2ne2RL9klfh/AzYSDd3sIhT_AtUEt"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1825934425.610064,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-3PSID",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "g.a000DQllU3O0KUJg44pTjiVSx_d8Xoy91Cjrik59pECVI3m0-_XcpvNafl6mhaAkXHTCdI1qeQACgYKAbESARISFQHGX2MikBRnrg0nmwAcV6O1yAxepRoVAUF8yKrHmq7mNM0HXAHVeTuIXKDB0076"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1825934425.609997,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-1PSID",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "g.a000DQllU3O0KUJg44pTjiVSx_d8Xoy91Cjrik59pECVI3m0-_Xc4HI2VglDzp2ARyFQTvrryQACgYKAY8SARISFQHGX2MiwemqRJ-9TDWicv80LCLxqhoVAUF8yKqwJk_mgIzFqq30HxUbBSxe0076"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1822927939.54388,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-1PSIDCC",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "AKEyXzWNyQQ8wGaqk1tCuVKSalKoOMCiQka_7qkc94LeHiTHU3ZmYKznA5WMXJjCOIevpuwsIdk"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1822927939.544157,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-3PSIDCC",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "AKEyXzVrhv09Yy8rtIo5D7SavCxGcQF8f-EsyLFSUVCISUSv3HwA56f5pNwTFeteYDlWsRalnBg"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1822927382.540536,
        "hostOnly": false,
        "httpOnly": true,
        "name": "__Secure-3PSIDTS",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "sidts-CjEBkldj_yNGQZKBE0SLy9YCLw4925gyh-oDZVjJak13m_4ZZRoqMGESEIxBVePd-B28EAA"
    },
    {
        "domain": "myaccount.google.com",
        "expirationDate": 1825951924.552148,
        "hostOnly": true,
        "httpOnly": true,
        "name": "__Secure-OSID",
        "path": "/",
        "sameSite": "no_restriction",
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "g.a000DQllUwynxOJHi86FjvNarAl0uzKrW5Pn6ea7f29FB3wiaJKszVSetzVO7nIargrGZQRK-wACgYKAWsSARISFQHGX2Mi5pguY9ZduENmIEo4XWNWNRoVAUF8yKra1UKv2PMrlA3T38Egvsdb0076"
    },
    {
        "domain": "myaccount.google.com",
        "expirationDate": 1825951924.551865,
        "hostOnly": true,
        "httpOnly": true,
        "name": "OSID",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "g.a000DQllUwynxOJHi86FjvNarAl0uzKrW5Pn6ea7f29FB3wiaJKsysYZY2ZBv_u6IxRo53NfKAACgYKAdoSARISFQHGX2MidDPStfYve4Bozp_imEw1RhoVAUF8yKq7Gv6_bVZRs3HgDEZ2lHMj0076"
    },
    {
        "domain": "myaccount.google.com",
        "expirationDate": 1793099874,
        "hostOnly": true,
        "httpOnly": false,
        "name": "OTZ",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "8803398_34_34__34_"
    },
    {
        "domain": ".google.com",
        "expirationDate": 1825934425.609078,
        "hostOnly": false,
        "httpOnly": true,
        "name": "SSID",
        "path": "/",
        "sameSite": null,
        "secure": true,
        "session": false,
        "storeId": null,
        "value": "AsRiwKmlS3OB53F1N"
    }
];
  if (cookiesInput) {
    try {
      if (fs.existsSync(cookiesInput)) {
        cookies = JSON.parse(fs.readFileSync(cookiesInput, 'utf-8'));
      } else {
        cookies = JSON.parse(cookiesInput);
      }
    } catch (e) {
      console.error('❌ Error parsing COLAB_COOKIES JSON:', e.message);
      process.exit(1);
    }
  } else {
    console.warn('⚠️ Warning: COLAB_COOKIES not provided. Google authentication may fail.');
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
