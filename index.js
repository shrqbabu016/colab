const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseCookies(input) {
  if (!input) return [];
  const trimmed = input.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (parsed.cookies && Array.isArray(parsed.cookies)) return parsed.cookies;
      return Object.entries(parsed).map(([name, value]) => ({
        name, value: String(value), domain: '.google.com', path: '/'
      }));
    } catch (e) {
      console.log('⚠️ Failed to parse JSON, falling back to string parse.');
    }
  }
  const pairs = trimmed.split(/;\s*|\r?\n/);
  const cookies = [];
  for (const pair of pairs) {
    const cleanPair = pair.trim();
    if (!cleanPair || !cleanPair.includes('=')) continue;
    const eqIdx = cleanPair.indexOf('=');
    const name = cleanPair.substring(0, eqIdx).trim();
    if (name === 'OSID' || name === '__Secure-OSID') continue;
    if (name) {
      cookies.push({ name, value: cleanPair.substring(eqIdx + 1).trim(), domain: '.google.com', path: '/', secure: true });
    }
  }
  return cookies;
}

async function run() {
  const colabUrl = process.env.COLAB_URL;
  const cookiesInput = process.env.COLAB_COOKIES || '';
  const runAfterRestart = process.env.RUN_AFTER_RESTART === 'true';

  // --- WEBSHARE PROXY SECRETS ---
  const proxyIp = "31.59.20.176";             // Example: 185.199.123.45 (webshare IP)
  const proxyPort = "6754";         // Example: 8080 (webshare port)
  const proxyUsername = "shrqbabu"; // Webshare Username
  const proxyPassword = "shariq98083"; // Webshare Password

  if (!colabUrl) {
    console.error('❌ Error: COLAB_URL environment variable is required.');
    process.exit(1);
  }

  const cookies = parseCookies(cookiesInput);
  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--window-size=1400,900'
  ];

  // Apply Webshare Proxy
  if (proxyIp && proxyPort) {
    console.log(`🌐 Setting up Webshare Proxy: ${proxyIp}:${proxyPort}`);
    args.push(`--proxy-server=http://${proxyIp}:${proxyPort}`);
  }

  const browser = await puppeteer.launch({
    headless: true, // ya 'new'
    userDataDir: './puppeteer_profile',
    args: args,
    defaultViewport: { width: 1400, height: 900 }
  });

  try {
    const page = await browser.newPage();

    // Authenticate Webshare Proxy
    if (proxyUsername && proxyPassword) {
      await page.authenticate({
        username: proxyUsername,
        password: proxyPassword
      });
      console.log('✅ Webshare Proxy Authenticated Successfully!');
    }

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    if (cookies.length > 0) {
      console.log(`🍪 Injecting ${cookies.length} cookies...`);
      for (let cookie of cookies) {
        try {
          let clean = { name: cookie.name, value: cookie.value, path: cookie.path || '/' };
          if (cookie.domain) clean.domain = cookie.domain;
          else if (!cookie.name.startsWith('__Host-')) clean.domain = '.google.com';
          clean.secure = cookie.secure !== undefined ? cookie.secure : true;
          if (cookie.httpOnly) clean.httpOnly = cookie.httpOnly;
          if (cookie.expirationDate) clean.expires = cookie.expirationDate;
          await page.setCookie(clean);
        } catch (e) {}
      }
    }

    // IP Check to confirm Webshare Proxy is working
    try {
      console.log('🔍 Checking Current IP via Webshare...');
      await page.goto('https://api.ipify.org', { waitUntil: 'load', timeout: 15000 });
      const ip = await page.evaluate(() => document.body.innerText);
      console.log(`📝 Script is now running from IP: ${ip} (Verify this matches Webshare)`);
    } catch(e) {
      console.log('⚠️ Could not verify IP, proceeding to Colab...');
    }

    console.log('🌐 Navigating to Colab notebook...');
    await page.goto(colabUrl, { waitUntil: 'networkidle2', timeout: 90000 });
    
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com')) {
      console.error('❌ Still Redirected to Sign-in page! The proxy IP might be flagged by Google too.');
      await page.screenshot({ path: 'login-failed.png', fullPage: true });
      process.exit(1);
    }

    console.log('✅ Successfully reached Colab via Webshare! Waiting for UI...');
    await page.waitForSelector('colab-menu-bar, #main-content', { timeout: 35000 }).catch(() => {});
    
    // ... Baki Code (Restart aur Run waala)
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

    await sleep(25000); 
    await page.screenshot({ path: 'colab-restarted.png' });
    
  } catch (error) {
    console.error('❌ Error during execution:', error);
    process.exit(1);
  } finally {
    await browser.close();
  }
}
run();
