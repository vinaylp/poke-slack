# 🚀 Complete Deployment Guide for Non-Technical Users

This guide will walk you through deploying your Slack-to-Poke integration step by step.

## Step 1: Push Code to GitHub (5 minutes)

The code is already committed and ready in `/Users/lp1/slack-poke-integration/`. Now you need to push it to your GitHub repository.

### Option A: Using GitHub Desktop (Easiest)

1. **Download GitHub Desktop** (if you don't have it):
   - Go to https://desktop.github.com/
   - Download and install

2. **Add the repository**:
   - Open GitHub Desktop
   - Click `File` → `Add Local Repository`
   - Choose `/Users/lp1/slack-poke-integration`
   - Click `Add Repository`

3. **Push to GitHub**:
   - Click `Publish repository` button
   - **IMPORTANT**: Change the name to `v40`
   - Uncheck "Keep this code private" if you want it public
   - Click `Publish repository`

✅ Done! Your code is now on GitHub at https://github.com/vinaylp/v40

### Option B: Using Terminal (For Advanced Users)

```bash
# Navigate to the project
cd /Users/lp1/slack-poke-integration

# If you haven't set up Git credentials, do this first:
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"

# Push to GitHub (you'll be asked for GitHub username and password/token)
git push -u origin main
```

**Note**: GitHub now requires a Personal Access Token instead of password:
1. Go to GitHub.com → Settings → Developer Settings → Personal Access Tokens
2. Generate new token with `repo` permissions
3. Use this token as your password when pushing

---

## Step 2: Create Slack App (10 minutes)

1. **Go to Slack Apps**:
   - Visit https://api.slack.com/apps
   - Click **"Create New App"**
   - Choose **"From scratch"**

2. **Configure App**:
   - **App Name**: `Poke Integration` (or any name you like)
   - **Workspace**: Select your Slack workspace
   - Click **"Create App"**

3. **Add OAuth Scopes**:
   - In the left sidebar, click **"OAuth & Permissions"**
   - Scroll down to **"Bot Token Scopes"**
   - Click **"Add an OAuth Scope"** and add these **4 scopes**:
     - `channels:history` - Read messages in channels
     - `channels:read` - View channel info
     - `users:read` - View user info
     - `users:read.email` - View user emails

4. **Install to Workspace**:
   - Scroll to top of the page
   - Click **"Install to Workspace"**
   - Click **"Allow"**

5. **Copy the Bot Token**:
   - You'll see **"Bot User OAuth Token"**
   - It starts with `xoxb-`
   - Click **"Copy"**
   - **Save this somewhere safe** - you'll need it for Vercel!

6. **Invite Bot to Channels**:
   - Go to your Slack workspace
   - Open each channel you want to monitor
   - Type: `/invite @Poke Integration`
   - Press Enter

7. **Get Channel IDs**:
   - In Slack, right-click the channel name
   - Click **"View channel details"**
   - Scroll to bottom - you'll see **"Channel ID"**
   - Copy it (looks like `C1234567890`)
   - Repeat for all channels you want to monitor
   - **Save these** - you'll need them!

---

## Step 3: Deploy to Vercel (5 minutes)

1. **Go to Vercel**:
   - Visit https://vercel.com/signup
   - Sign up with your GitHub account (easiest)

2. **Import Project**:
   - Click **"Add New..."** → **"Project"**
   - You'll see your GitHub repositories
   - Find `v40` and click **"Import"**

3. **Configure Project**:
   - **Framework Preset**: Leave as detected (should be "Other")
   - **Root Directory**: Leave as `./`
   - Click **"Environment Variables"** section

4. **Add Environment Variables** (THIS IS IMPORTANT!):

   Click **"Add"** for each of these:

   | Name | Value | Where to get it |
   |------|-------|----------------|
   | `SLACK_BOT_TOKEN` | `xoxb-...` | From Step 2 #5 (Slack OAuth Token) |
   | `SLACK_MONITOR_CHANNELS` | `C123,C456` | From Step 2 #7 (comma-separated) |
   | `POKE_WEBHOOK_URL` | Your Poke URL | Your Poke webhook endpoint |
   | `CRON_SECRET` | Random string | Generate below ⬇️ |
   | `POKE_API_KEY` | (Optional) | If Poke requires auth |

   **To generate CRON_SECRET**:
   - Open Terminal
   - Run: `openssl rand -hex 32`
   - Copy the output
   - Or just use: `my-super-secret-key-12345`

5. **Deploy**:
   - Click **"Deploy"**
   - Wait 1-2 minutes for deployment to complete
   - You'll see **"Congratulations!"** when done

6. **Get Your URL**:
   - You'll see something like: `v40-abc123.vercel.app`
   - Copy this URL - this is your deployment!

---

## Step 4: Test Everything (5 minutes)

### Test 1: Check Health

Open your browser and visit:
```
https://v40-abc123.vercel.app/api/health
```
(Replace `v40-abc123` with your actual Vercel URL)

You should see:
```json
{
  "status": "healthy",
  "configuration": {
    "monitoredChannelsCount": 2,
    "slackConfigured": true,
    "pokeConfigured": true
  }
}
```

✅ If you see this, configuration is correct!

### Test 2: Manual Sync

Open Terminal and run:
```bash
curl -X POST https://v40-abc123.vercel.app/api/cron/sync \
  -H "Authorization: Bearer your-cron-secret"
```

(Replace `v40-abc123` with your URL and `your-cron-secret` with your CRON_SECRET)

You should see:
```json
{
  "success": true,
  "summary": {
    "channelsPolled": 2,
    "totalMessages": 5,
    "messagesSent": 5
  }
}
```

✅ If you see this, the sync is working!

### Test 3: Check Vercel Cron Logs

1. Go to Vercel Dashboard: https://vercel.com/dashboard
2. Click on your `v40` project
3. Click **"Deployments"** tab
4. Click **"Cron Logs"**
5. You should see executions every 5 minutes

✅ If you see cron logs, automation is working!

---

## 🎉 You're Done!

Your integration is now:
- ✅ Running automatically every 5 minutes
- ✅ Polling your Slack channels for new messages
- ✅ Sending messages to Poke webhook
- ✅ Tracking state to avoid duplicates

## 📊 Monitoring

### View Logs in Vercel

1. Go to Vercel Dashboard
2. Click your project
3. Click **"Logs"** tab
4. You'll see real-time activity

### View Cron History

1. In Vercel Dashboard
2. Click **"Deployments"**
3. Click **"Cron Logs"**
4. See execution history

---

## 🆘 Troubleshooting

### Problem: Health check shows "unhealthy"

**Solution**: Check environment variables
1. Go to Vercel Dashboard → Your Project
2. Click **"Settings"** → **"Environment Variables"**
3. Verify all required variables are set
4. Redeploy: `Deployments` → Latest → `...` → `Redeploy`

### Problem: No messages being sent

**Solution**: Check Slack permissions
1. Did you invite the bot to channels? (`/invite @Poke Integration`)
2. Are the channel IDs correct?
3. Check Vercel logs for errors

### Problem: Cron not running

**Solution**: Verify Vercel plan
1. Cron requires Vercel **Hobby plan ($20/month)** or higher
2. Free plan doesn't support cron
3. Upgrade at: Vercel Dashboard → Account Settings → Billing

### Problem: "403 Forbidden" when pushing to GitHub

**Solution**: Set up authentication
1. Use GitHub Desktop (easiest - Option A above)
2. Or create a Personal Access Token:
   - GitHub.com → Settings → Developer Settings
   - Personal Access Tokens → Generate New Token
   - Select `repo` scope
   - Use token as password when pushing

---

## 📞 Need Help?

If something's not working:

1. **Check Vercel Logs**: Most issues show up here
2. **Check Health Endpoint**: Tells you what's misconfigured
3. **Check Slack App**: Ensure all scopes are added
4. **Check Environment Variables**: Most common issue!

---

## 💰 Costs

- **GitHub**: Free
- **Slack**: Free
- **Vercel**:
  - Free plan: No cron support ❌
  - Hobby plan: $20/month (includes unlimited cron) ✅
  - Pro plan: $20/user/month

---

## 🔄 Making Changes

If you need to update the code:

1. **Edit files** in `/Users/lp1/slack-poke-integration/`
2. **Commit changes**:
   ```bash
   cd /Users/lp1/slack-poke-integration
   git add .
   git commit -m "Description of changes"
   git push
   ```
3. **Vercel auto-deploys** from GitHub!

---

## 🔐 Security Checklist

- ✅ NEVER commit `.env` file
- ✅ Set `CRON_SECRET` in production
- ✅ Rotate secrets every 90 days
- ✅ Use environment variables for all secrets
- ✅ Monitor logs for suspicious activity

---

## ⚙️ Configuration

### Change Sync Frequency

Edit `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/sync",
    "schedule": "*/15 * * * *"  // Change to every 15 minutes
  }]
}
```

Common schedules:
- Every 5 minutes: `*/5 * * * *`
- Every 15 minutes: `*/15 * * * *`
- Every hour: `0 * * * *`
- Every day at 9am: `0 9 * * *`

### Add More Channels

1. In Slack, invite bot to new channel: `/invite @Poke Integration`
2. Get channel ID: Right-click → View channel details → Copy ID
3. In Vercel Dashboard → Settings → Environment Variables
4. Edit `SLACK_MONITOR_CHANNELS`
5. Add new ID: `C123,C456,C789`
6. Redeploy

---

Good luck! 🚀
