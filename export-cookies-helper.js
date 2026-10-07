const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

async function exportCookies() {
  console.log('🌐 Opening browser window for Google Login...');
  console.log('👉 Please log into your Google account and open Colab.');
  console.log('👉 When you are logged in and inside your Colab notebook, return to this terminal and press ENTER.\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800'],
    defaultViewport: null
  });

  const page = await browser.newPage();
  await page.goto('https://colab.research.google.com/', { waitUntil: 'networkidle2' });

  // Wait for user to press ENTER in terminal
  await new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once('data', () => {
      resolve();
    });
  });

  // Use CDP session to get ALL cookies across all domains (Google, Drive, Colab)
  const client = await page.target().createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');

  // Filter Google-related cookies
  const googleCookies = cookies.filter(
    (c) => c.domain.includes('google.com') || c.domain.includes('googleusercontent.com')
  );

  fs.writeFileSync('cookies.json', JSON.stringify(googleCookies, null, 2));

  console.log(`\n✅ Saved ${googleCookies.length} Google cookies to cookies.json!`);
  console.log('📋 Now copy the entire contents of cookies.json and paste it into GitHub Secrets as COLAB_COOKIES.');

  await browser.close();
  process.exit(0);
}

exportCookies().catch((err) => {
  console.error('❌ Error exporting cookies:', err);
  process.exit(1);
});
