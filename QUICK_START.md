# ⚡ Quick Start Guide - 3 Steps

## 1️⃣ Push to GitHub (Choose One Method)

### Method A: GitHub Desktop (Recommended - No Terminal!)
1. Download: https://desktop.github.com/
2. Open GitHub Desktop
3. File → Add Local Repository
4. Select: `/Users/lp1/slack-poke-integration`
5. Click "Publish repository"
6. Name it: `v40`
7. Click "Publish"

### Method B: Terminal
```bash
cd /Users/lp1/slack-poke-integration
git push -u origin main
```
(You'll need GitHub username + Personal Access Token)

---

## 2️⃣ Create Slack App

1. Go to: https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Name: `Poke Integration`
4. Add these scopes in OAuth & Permissions:
   - `channels:history`
   - `channels:read`
   - `users:read`
   - `users:read.email`
5. Click "Install to Workspace"
6. **COPY THE TOKEN** (starts with `xoxb-`)
7. Invite bot to channels: `/invite @Poke Integration`
8. Get Channel IDs: Right-click channel → View details → Copy ID

---

## 3️⃣ Deploy to Vercel

1. Go to: https://vercel.com/signup (sign up with GitHub)
2. Click "Add New..." → "Project"
3. Import `v40` repository
4. Add these environment variables:

```
SLACK_BOT_TOKEN = xoxb-your-token-here
SLACK_MONITOR_CHANNELS = C123456,C789012
POKE_WEBHOOK_URL = https://your-poke-url.com/webhook
CRON_SECRET = any-random-string-here
```

5. Click "Deploy"
6. Wait 2 minutes
7. Done! 🎉

---

## ✅ Test It Works

Visit: `https://your-app.vercel.app/api/health`

Should see:
```json
{"status": "healthy", "slackConfigured": true}
```

---

## 📁 Where is Everything?

- **Code Location**: `/Users/lp1/slack-poke-integration/`
- **GitHub Repo**: https://github.com/vinaylp/v40
- **Vercel Dashboard**: https://vercel.com/dashboard

---

## 🔑 What You Need

From Slack:
- Bot Token (starts with `xoxb-`)
- Channel IDs (look like `C1234567890`)

From Poke:
- Webhook URL
- API Key (if needed)

Generate yourself:
- CRON_SECRET (any random string)

---

## 🆘 Common Issues

**"Channel not found"** → Invite bot: `/invite @Poke Integration`

**"Unhealthy" status** → Check environment variables in Vercel

**Cron not working** → Need Vercel Hobby plan ($20/month)

**Can't push to GitHub** → Use GitHub Desktop (Method A)

---

**See DEPLOYMENT_GUIDE.md for detailed instructions!**
