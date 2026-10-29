# Getting Started — Newtech Quotation Desk

For new developers. Follow the steps in order. Should take about 30 minutes.

If a step fails, stop and ask — do not skip it. Every step is needed by a later one.

---

## What you are given

Three files. Copy them to your laptop, into one folder (for example `C:\newtech-setup`):

| File | What it is |
|---|---|
| `newtech-ca.crt` | A security certificate, so your laptop trusts our GitLab server |
| `setup-workstation.ps1` | A script that sets your laptop up |
| `ONBOARDING.md` | This file |

---

## Step 1 — Install the tools

Install these three. Accept all the default options.

| Tool | Where |
|---|---|
| **Node.js 22 LTS** | https://nodejs.org |
| **Git for Windows** | https://git-scm.com/download/win |
| **VS Code** | https://code.visualstudio.com |

Check they worked. Open **PowerShell** and run:

```powershell
node --version
git --version
```

You should see version numbers. If you see "not recognised", close PowerShell, open it again, and retry.

---

## Step 2 — Connect your laptop to our GitLab

Open PowerShell **as Administrator**:
right-click the Start button, choose **Terminal (Admin)** or **Windows PowerShell (Admin)**.

Go to the folder with your three files:

```powershell
cd C:\newtech-setup
```

Run these three commands, one at a time:

```powershell
Unblock-File .\setup-workstation.ps1
Unblock-File .\newtech-ca.crt
.\setup-workstation.ps1 -CaCert .\newtech-ca.crt
```

> **Why `Unblock-File`?** Windows marks any file that came from another computer as
> untrusted and refuses to run it. This clears that mark. It changes nothing else.

**What you should see at the end:**

```
https://gitlab.newtech.internal  ->  HTTP 200  (certificate accepted)
```

**If you see `HTTP 200`, this step worked.** Move on.

If it says it cannot reach the server, see **Problems** at the bottom.

---

## Step 3 — Log in to GitLab

Open a browser and go to:

**https://gitlab.newtech.internal**

Sign in with the username and password your administrator gave you.

Change your password when asked. Turn on two-factor authentication if prompted.

There should be **no security warning**. If there is, Step 2 did not finish properly.

---

## Step 4 — Set up your key for downloading code

This lets Git talk to GitLab without asking for a password every time.

In a **normal** PowerShell window (not Administrator):

```powershell
ssh-keygen -t ed25519 -C "your.name@newtech.in"
```

Press **Enter** three times to accept the defaults.

Now copy your key:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | Set-Clipboard
```

In GitLab: click your **picture** (top right) -> **Edit profile** -> **SSH Keys** ->
paste into the big box -> **Add key**.

---

## Step 5 — Download the code

Pick a folder for your work, then:

```powershell
cd C:\Users\YourName\Documents
git clone git@gitlab.newtech.internal:newtech/quotation-desk.git
cd quotation-desk
```

The first time, it asks if you trust the server. **Check the code shown matches this
exactly**, then type `yes`:

```
SHA256:kOObkOLZcTNPL6IMUKsPNSK6FLEErhVuZS5xC3l1WNc
```

If it does not match, stop and tell your administrator.

---

## Step 6 — Set up the application

Run these in order, inside the `quotation-desk` folder:

```powershell
npm ci
Copy-Item .env.example .env
npm run build:template
```

Then load the customer list. Ask your administrator for the customer file, then:

```powershell
npm run import:customers "C:\path\to\the\customer-file.xlsx"
```

> **About `.env`:** you can leave it as it is. The AI features need a `GEMINI_API_KEY`,
> but **everything else works without one**. Ask if you need one.

---

## Step 7 — Run it

```powershell
npm run dev
```

Open **http://localhost:5173** in your browser.

You should see the Quotation Desk. **You are done.**

To stop it, press `Ctrl + C` in PowerShell.

---

## How we work day to day

**Never work directly on `main`.** The server will refuse it anyway.

Every change follows the same five steps:

```powershell
# 1. Start from the latest code
git checkout main
git pull

# 2. Make a branch. Use a short name that says what you are doing.
git checkout -b feature/add-discount-column

# 3. Do your work, then save it
git add .
git commit -m "Add a discount column to the quotation editor"

# 4. Send it to GitLab
git push -u origin feature/add-discount-column

# 5. Open a Merge Request
```

For step 5, the `git push` prints a link. Open it, add a title, and click
**Create merge request**.

**What happens next:** the server automatically builds your change and runs all 450
tests. This takes a few minutes.

- **Green tick** -> ready for someone to review and merge
- **Red cross** -> something broke. Click it to see what. Fix it, commit, and push again.

**You cannot merge your own work.** A senior developer merges it. This is deliberate —
it means someone always looks at every change.

---

## Rules worth knowing before you write code

These are not style preferences. Breaking them causes real problems.

**1. Money is always whole paise, stored as a whole number.**
Never use decimals for money. A quotation that is one paisa wrong is one the customer's
system rejects.

**2. A customer is a ledger, not a name.**
Fourteen different customers are spelled "Datamatics Global Services Limited". Never
assume two rows are the same customer because the names match. Never pick one on the
user's behalf.

**3. Run the tests before you push.**

```powershell
npm test
```

All 450 must pass. If you broke one, the server will catch it anyway — but finding out
yourself is faster.

**4. Never commit passwords or keys.** The `.env` file is already excluded from Git.
Leave it that way.

---

## Problems

**"cannot be loaded because running scripts is disabled"**
You skipped the `Unblock-File` commands in Step 2. Go back and run all three.

**"This site can't be reached" in the browser, but ping works**
Your laptop does not know the name `gitlab.newtech.internal` yet. Step 2 fixes this.
Ping working only means the network is fine — it does not mean the name works.

**Certificate or "not secure" warning in the browser**
The certificate did not install. Run Step 2 again, as Administrator.

**`git clone` says "Permission denied (publickey)"**
Your SSH key is not in GitLab. Redo Step 4.

**`npm ci` fails**
You are probably not inside the `quotation-desk` folder. Run `dir` and check you can
see `package.json`.

**PDF button does not work on your machine**
Normal. PDFs need Microsoft Word or LibreOffice installed. Word documents (`.docx`)
still work fine, and the server makes the PDFs. Ignore it unless you are working on
PDF code.

---

## Where to read more

| File | What is in it |
|---|---|
| `README.md` | What the application does and how it is built |
| `PROJECT-LOG.md` | Why things were built the way they were. **Read section 10 first.** |
| `CLAUDE.md` | Rules for AI assistants — read this before using AI on this project |
