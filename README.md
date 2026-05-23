# NovaSpend — Premium Expenses Dashboard

NovaSpend is a gorgeous, fully-featured, database-less expenses tracker designed for everyday budgeting and payee tracking. It features a modern dark-mode fintech interface, dynamic spending analytics, and an integrated **GitHub Sync** engine allowing collaborative tracking directly within your repository.

![NovaSpend Dashboard](https://img.shields.io/badge/Interface-Glassmorphism-blueviolet?style=for-the-badge)
![Built With](https://img.shields.io/badge/Tech-HTML5_/_CSS3_/_Vanilla_JS-6366f1?style=for-the-badge)
![Database](https://img.shields.io/badge/Database-None_/_Local_Storage_/_GitHub_Sync-10b981?style=for-the-badge)

---

## 🌟 Key Features

1. **Everyday Expense Tracking**: Fast entries with custom categories, dates, receipts/notes, and recipients.
2. **Payee Tracking**: Tag specific people or businesses to expenses ("Paying to someone" category) to manage splitted or outstanding payouts.
3. **Core Financial Metrics**:
   - **Cash in Hand**: Net cash currently available (`Total Deposits - Total Paid Expenses`).
   - **Total Expenses**: All recorded outflows (both settled and unsettled).
   - **Total Deposits**: Total budget received/logged (cash in-flows).
   - **Outstanding**: Unsettled expenses that need to be paid in the future.
4. **Spending Analytics**: Dynamic visual charts Powered by Chart.js:
   - **Donut Chart**: Interactive category breakdown.
   - **Monthly Trends**: Multi-month comparisons of inflows vs. outflows.
5. **No Database Required**:
   - **LocalStorage fallback**: Instant automatic persistence directly in the browser.
   - **GitHub Sync (Collaborative Mode)**: Configurable endpoint that reads/writes data to an `expenses.json` file inside your repository. Allows different users to share and edit the same data securely!
   - **Manual JSON Backups**: Full export/import capabilities for data archiving.

---

## 🚀 Setup & Launching Locally

Since NovaSpend is built as a Single Page Application (SPA) using vanilla HTML, CSS, and JS, **no build steps or node modules are required**. 

### Quick Start
You can launch NovaSpend on your local machine by double-clicking the `index.html` file, or by hosting it on a simple HTTP server:

```powershell
# Using Python
python -m http.server 8000

# Using Node.js (Vite, HTTP-Server or Browser-sync)
npx http-server
```
Open `http://localhost:8000` (or the port specified) in your browser.

---

## 🔗 How to set up GitHub Sync (Collaborative Mode)

To share the expenses dashboard with other users and access it across multiple devices, you can utilize the built-in GitHub Sync capability. It works by using GitHub's contents API to read and commit updates to your repository directly.

### Step 1: Create a Personal Access Token (PAT)
1. Go to your GitHub account **Settings** > **Developer Settings** > **Personal Access Tokens**.
2. We recommend generating a **Fine-grained Personal Access Token** or a **Classic Token**:
   - **Fine-grained Token**: Select your repository (`Manage-Expenses`), and under **Repository permissions**, grant **Read & Write** access to **Contents**.
   - **Classic Token**: Check the `repo` scope (full control of private repositories).
3. Copy the generated token (`ghp_...`). *Keep it secure!*

### Step 2: Configure NovaSpend
1. Click the **Sync Settings** button in the sidebar of NovaSpend.
2. Change the *Persistence Mode* to **GitHub Sync Repository**.
3. Input your credentials:
   - **Username**: `Vijayan16`
   - **Repository Name**: `Manage-Expenses`
   - **Branch**: `main` (or the branch you publish from)
   - **Data File Path**: `expenses.json`
   - **Access Token**: Paste your Personal Access Token.
4. Click **Test Sync** to verify the connection. If correct, NovaSpend will load any existing data from the repo.
5. Click **Save Settings**.

Now, whenever you log an expense, toggle a status, or delete items, NovaSpend will auto-commit the updates back to your repository. When other users open their dashboard configured with the same repo and credentials, they will pull and view the shared data automatically!

---

## 🌐 Publishing to GitHub Pages

You can easily host this dashboard live for free on GitHub Pages:

1. Push these files (`index.html`, `style.css`, `app.js`, `README.md`) to your GitHub repository:
   ```bash
   git add .
   git commit -m "Initialize NovaSpend Expense tracker"
   git push origin main
   ```
2. Navigate to your repository page on GitHub.
3. Click **Settings** > **Pages** (under Code and automation).
4. Under **Build and deployment**, set the *Source* to **Deploy from a branch**.
5. Select your branch (`main`) and folder (`/ (root)`), then click **Save**.
6. GitHub will generate a URL for your site within a minute (e.g. `https://Vijayan16.github.io/Manage-Expenses/`).

---

## 🛡️ Data Privacy

- Your Personal Access Token (PAT) is stored strictly in your browser's local storage (`localStorage`).
- The token is only sent directly to `api.github.com` via secure HTTPS connection headers.
- **Never commit your configuration file or Personal Access Tokens directly to code repositories.**
