# Colab Auto Restarter (Puppeteer + GitHub Actions)

Google Colab session ko automatically restart karne ke liye Puppeteer script aur GitHub Actions workflow. Yeh har 1 ghante (`cron: '0 * * * *'`) par apne aap run hoga.

---

## 📁 Project Structure

- `index.js` - Main automation script (Stealth Puppeteer, Cookie injection, Colab restart & Run All)
- `export-cookies-helper.js` - Local helper script jisse aap aasani se cookies export kar sakte hain
- `.github/workflows/colab-restart.yml` - GitHub Actions workflow jo har 1 ghante mein run hoga
- `package.json` - Node.js dependencies

---

## 🛠️ Setup Guide (Step-by-Step)

### Step 1: Dependencies Install Karein
```bash
npm install
```

---

### Step 2: Google Colab Cookies Nikalein (2 Aasaan Tarike)

Puppeteer headless browser me Google directly login nahi karne deta (bot detection ki wajah se), isliye cookies use karna sabse best tarika hai:

#### **Tarika A (Chrome Extension - Sabse Aasaan):**
1. Apne regular browser me **"Cookie-Editor"** extension install karein.
2. [Google Colab](https://colab.research.google.com/) open karein aur login karein.
3. Extension icon par click karein aur **"Export"** -> **"Export as JSON"** select karein.
4. Jo JSON copy hua hai, usko save karke rakhein.

#### **Tarika B (Local Helper Script se):**
1. Terminal me run karein:
   ```bash
   npm run export-cookies
   ```
2. Ek browser khulega. Usme Google login karke apna Colab notebook open karein.
3. Login hone ke baad terminal me aakar **ENTER** press karein.
4. Ek `cookies.json` file ban jayegi.

---

### Step 3: GitHub Repository Create Karein aur Code Push Karein

1. GitHub par ek **Private Repository** banayein (taaki aapki secrets safe rahein).
2. Code push karein:
   ```bash
   git init
   git add .
   git commit -m "feat: colab auto restarter"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```

---

### Step 4: GitHub Secrets Configure Karein

1. Apni GitHub Repository me jayein -> **Settings** -> **Secrets and variables** -> **Actions**.
2. **New repository secret** par click karein:
   - **Secret 1**:
     - Name: `COLAB_URL`
     - Value: `https://colab.research.google.com/drive/YOUR_NOTEBOOK_ID`
   - **Secret 2**:
     - Name: `COLAB_COOKIES`
     - Value: Jo JSON cookies aapne Step 2 me copy ki thi, use pura yahan paste kar dein.

---

### Step 5: Test Karein (Manual Trigger)

1. GitHub Repository me **Actions** tab par jayein.
2. Left side me **"Colab Auto Restarter"** workflow select karein.
3. **"Run workflow"** button par click karein.
4. Execution complete hone ke baad workflow run me jaakar **Artifacts** section me screenshots (`colab-loaded.png`, `colab-restarted.png`) dekh sakte hain.

---

## ⏰ Schedule Details

GitHub Actions workflow har ghante run hone ke liye configured hai:
```yaml
schedule:
  - cron: '0 * * * *' # Every hour at minute 0
```
Agar aapko notebook restart ke baad **Run all cells** nahi karna, toh `.github/workflows/colab-restart.yml` me `RUN_AFTER_RESTART: 'false'` kar sakte hain.
