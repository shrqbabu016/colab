const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Enable stealth to minimize Google bot detection
puppeteer.use(StealthPlugin());

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCookies(input) {
  if (!input) return [];
  const trimmed = input.trim();

  // 1. Handling JSON format (Both full Object containing 'cookies' array, or direct Array)
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      
      // Agar direct array diya hai: [ {name: "foo", ...} ]
      if (Array.isArray(parsed)) return parsed;
      
      // Agar pura JSON object paste kar diya gaya hai (jaise extension se aata hai)
      if (parsed.cookies && Array.isArray(parsed.cookies)) return parsed.cookies;
      
      return Object.entries(parsed).map(([name, value]) => ({
        name, value: String(value), domain: '.google.com', path: '/'
      }));
    } catch (e) {
      console.log('⚠️ Failed to parse valid JSON. Falling back to string split.');
    }
  }

  // 2. String fallback (Less reliable for Google Drive auth)
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

  // Ab yeh automatically pura JSON read kar lega
  const cookies = parseCookies(cookiesInput);
  
  console.log(`🚀 Starting Colab Auto Restarter...`);
  
  const browser = await puppeteer.launch({
    headless: true,
    userDataDir: './puppeteer_profile',
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

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Inject Cookies
    if (cookies.length > 0) {
      console.log(`🍪 Injecting ${cookies.length} cookies...`);
      for (let cookie of cookies) {
        try {
          let clean = {
            name: cookie.name,
            value: cookie.value,
            path: cookie.path || '/'
          };

          if (cookie.domain) {
              clean.domain = cookie.domain;
          } else if (!cookie.name.startsWith('__Host-')) {
              clean.domain = '.google.com';
          }

          clean.secure = cookie.secure !== undefined ? cookie.secure : true;
          if (cookie.httpOnly) clean.httpOnly = cookie.httpOnly;
          if (cookie.expirationDate) clean.expires = cookie.expirationDate;

          await page.setCookie(clean);
        } catch (e) {}
      }
      console.log(`✅ Cookies injected!`);
    } else {
      console.log('ℹ️ Using previously saved browser profile from cache (No new cookies string provided).');
    }

    console.log('🌐 Navigating to Colab notebook...');
    await page.goto(colabUrl, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(6000);

    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      console.error('❌ Redirected to Google Sign-in page! Cookies are expired or Google blocked the IP.');
      await page.screenshot({ path: 'login-failed.png', fullPage: true });
      process.exit(1);
    }

    // Check for "Notebook loading error" modal
    const hasErrorModal = await page.evaluate(() => {
        const modal = document.querySelector('colab-dialog[class="error"]');
        if (!modal) return false;
        const text = (modal.innerText || '').toLowerCase();
        if(text.includes('notebook loading error') && text.includes('invalid authentication credentials')) {
            const btn = modal.querySelector('mwc-button#ok, button');
            if(btn) btn.click();
            return true;
        }
        return false;
    });

    if (hasErrorModal) {
         console.error('❌ Colab UI loaded but Drive denied OAuth credentials (see screenshot). Google blocked the session from accessing Google Drive due to location mismatch.');
         await page.screenshot({ path: 'drive-oauth-denied.png' });
         process.exit(1); 
    }

    console.log('✅ Successfully reached Colab! Waiting for UI elements...');
    
    await page.waitForSelector('colab-menu-bar, #main-content', { timeout: 35000 }).catch(() => console.log('UI wait timeout, proceeding...'));
    await page.screenshot({ path: 'colab-loaded.png' });

    console.log('▶️ Running restart logic...');
    await sleep(5000); 

    if (runAfterRestart) {
      console.log('⌨️ Sending backup "Run All" (Ctrl+F9)...');
      await page.focus('body');
      await page.keyboard.down('Control');
      await page.keyboard.press('F9');
      await page.keyboard.up('Control');
      
      await sleep(2000);
      await page.evaluate(() => {
          const runAnywayBtn = document.querySelector('colab-dialog paper-button#ok, colab-dialog mwc-button#ok');
          if (runAnywayBtn) runAnywayBtn.click();
      }).catch(() => {});
    }

    console.log('⏳ Waiting for execution to propagate...');
    await sleep(25000); 
    await page.screenshot({ path: 'colab-restarted.png' });
    
  } catch (error) {
    console.error('❌ Error during execution:', error);
    try { await page.screenshot({ path: 'error-state.png' }); } catch {}
    process.exit(1);
  } finally {
    await browser.close();
    console.log('🏁 Browser closed. Profile saved.');
  }
}

run();
