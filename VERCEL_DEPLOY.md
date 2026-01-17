# 🚀 Deploy to Vercel - Step by Step

Your code is on GitHub: https://github.com/vinaylp/v40

Now let's deploy it to Vercel!

---

## Part 1: Create Slack App (10 minutes)

### Step 1: Go to Slack Apps
Visit: **https://api.slack.com/apps**

### Step 2: Create New App
1. Click **"Create New App"**
2. Choose **"From scratch"**
3. **App Name**: `Poke Integration`
4. **Workspace**: Select your Slack workspace
5. Click **"Create App"**

### Step 3: Add Permissions
1. In left sidebar, click **"OAuth & Permissions"**
2. Scroll to **"Bot Token Scopes"**
3. Click **"Add an OAuth Scope"** and add these **4 scopes**:
   - `channels:history`
   - `channels:read`
   - `users:read`
   - `users:read.email`

### Step 4: Install App
1. Scroll to top of page
2. Click **"Install to Workspace"**
3. Review permissions
4. Click **"Allow"**

### Step 5: Copy Bot Token
1. After install, you'll see **"Bot User OAuth Token"**
2. It starts with `xoxb-`
3. Click **"Copy"**
4. **SAVE THIS** - paste it somewhere safe (you'll need it for Vercel!)

### Step 6: Get Channel IDs
For each Slack channel you want to monitor:

1. In Slack app, **right-click** the channel name
2. Click **"View channel details"**
3. Scroll to bottom
4. You'll see **"Channel ID"** (like `C1234567890`)
5. **Copy it**
6. If monitoring multiple channels, separate with commas: `C123,C456,C789`

### Step 7: Invite Bot to Channels
For each channel:

1. Open the channel in Slack
2. Type: `/invite @Poke Integration`
3. Press Enter

✅ **Slack setup done!** You should now have:
- Bot Token (starts with `xoxb-`)
- Channel IDs (like `C123,C456`)

---

## Part 2: Deploy to Vercel (5 minutes)

### Step 1: Sign Up
1. Go to: **https://vercel.com/signup**
2. Click **"Continue with GitHub"**
3. Authorize Vercel
4. You'll land on Vercel dashboard

### Step 2: Import Project
1. Click **"Add New..."** → **"Project"**
2. Find **"v40"** in the list
3. Click **"Import"**

### Step 3: Configure Environment Variables

You'll see a section called **"Environment Variables"**.

Click **"Add"** for each of these:

#### Variable 1: SLACK_BOT_TOKEN
- **Name**: `SLACK_BOT_TOKEN`
- **Value**: Paste the `xoxb-...` token from Slack (Step 5 above)

#### Variable 2: SLACK_MONITOR_CHANNELS
- **Name**: `SLACK_MONITOR_CHANNELS`
- **Value**: Your channel IDs (like `C123456,C789012`)

#### Variable 3: POKE_WEBHOOK_URL
- **Name**: `POKE_WEBHOOK_URL`
- **Value**: Your Poke webhook URL

#### Variable 4: CRON_SECRET
- **Name**: `CRON_SECRET`
- **Value**: Generate a random string

**To generate CRON_SECRET:**

Open Terminal and run:
```bash
openssl rand -hex 32
```

Copy the output and paste as the value.

Or just use any random string like: `my-super-secret-cron-key-12345`

#### Variable 5: POKE_API_KEY (Optional)
- **Name**: `POKE_API_KEY`
- **Value**: Your Poke API key (if Poke requires authentication)
- **Skip if not needed**

### Step 4: Deploy!
1. Click the blue **"Deploy"** button
2. Wait 1-2 minutes
3. You'll see **"Congratulations!"** when done

### Step 5: Get Your URL
After deployment:
- You'll see your app URL: `https://v40-abc123.vercel.app`
- Copy this URL

---

## Part 3: Test It! (2 minutes)

### Test 1: Health Check
Open browser and visit:
```
https://your-app.vercel.app/api/health
```

You should see:
```json
{
  "status": "healthy",
  "configuration": {
    "slackConfigured": true,
    "pokeConfigured": true
  }
}
```

✅ If you see this, everything is configured correctly!

### Test 2: Manual Sync
Open Terminal and run:
```bash
curl -X POST https://your-app.vercel.app/api/cron/sync \
  -H "Authorization: Bearer your-cron-secret"
```

(Replace `your-cron-secret` with the CRON_SECRET you set)

You should see:
```json
{
  "success": true,
  "summary": {
    "channelsPolled": 2,
    "totalMessages": 5
  }
}
```

✅ If you see this, sync is working!

---

## 🎉 You're Done!

Your integration is now:
- ✅ Live on Vercel
- ✅ Running automatically every 5 minutes
- ✅ Monitoring your Slack channels
- ✅ Sending new messages to Poke

---

## 📊 Monitor Your Integration

### View Logs
1. Go to Vercel dashboard
2. Click your **v40** project
3. Click **"Logs"** tab
4. See real-time activity

### View Cron Executions
1. In Vercel project
2. Click **"Deployments"**
3. Click **"Cron Logs"**
4. See every 5-minute sync

---

## 🆘 Troubleshooting

### "unhealthy" status
- Check environment variables in Vercel
- Make sure all required variables are set
- Redeploy: Deployments → ... → Redeploy

### No messages appearing
- Did you invite bot to channels? `/invite @Poke Integration`
- Are channel IDs correct?
- Check Vercel logs for errors

### Cron not running
- Requires Vercel **Hobby plan ($20/month)**
- Free plan doesn't support cron
- Upgrade: Settings → Billing

---

## 💡 What Happens Now?

Every 5 minutes, automatically:
1. ⏰ Vercel Cron triggers
2. 📡 Fetches new Slack messages
3. 📤 Sends to Poke webhook
4. 💾 Saves timestamp for next sync

No manual work needed!

---

## 📞 Need Help?

Open the full guide:
```bash
open /Users/lp1/Documents/GitHub/v40/DEPLOYMENT_GUIDE.md
```

Good luck! 🚀
