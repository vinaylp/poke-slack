# Slack-to-Poke Integration

A serverless integration that automatically polls Slack channels on a schedule and forwards new messages to Poke via webhook. Built with Node.js and deployed on Vercel with Vercel Cron.

## Features

- **Automatic Polling**: Runs every 5 minutes (configurable) to check for new messages
- **Smart State Tracking**: Tracks last processed timestamp per channel to avoid duplicates
- **Rich Context**: Enriches messages with user information (name, email, avatar)
- **Secure**: API key authentication for both Poke webhook and cron endpoint
- **Serverless**: Deploys to Vercel with zero infrastructure management
- **Robust Error Handling**: Retry logic with exponential backoff for Poke webhooks
- **Thread-Aware**: Identifies replies and includes parent thread context

## Architecture

```
┌──────────────┐         ┌──────────────────┐         ┌──────────┐
│ Vercel Cron  │ Trigger │     Serverless   │ Webhook │   Poke   │
│ (every 5min) │────────▶│    Function      │────────▶│          │
└──────────────┘         └──────────────────┘         └──────────┘
                                 │
                                 ▼
                         ┌──────────────────┐
                         │  Slack Web API   │
                         │ (fetch messages) │
                         └──────────────────┘
                                 │
                                 ▼
                         ┌──────────────────┐
                         │  State Manager   │
                         │ (last timestamp) │
                         └──────────────────┘
```

## How It Works

1. **Vercel Cron triggers** the sync function every 5 minutes
2. **State manager** retrieves the last processed timestamp for each channel
3. **Message poller** fetches new messages from Slack since last sync
4. **User enrichment** adds profile data (name, email, avatar) to each message
5. **JSON formatting** structures the data for Poke's webhook endpoint
6. **Webhook delivery** sends messages to Poke with retry logic
7. **State update** saves the latest timestamp for next sync

## Prerequisites

- **Slack workspace** with admin access to create apps
- **Poke webhook endpoint** to receive message data
- **Vercel account** (Hobby or Pro plan for Cron support)
- **Node.js 18+** for local development

## Quick Start

### 1. Clone and Install

```bash
cd slack-poke-integration
npm install
```

### 2. Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your actual credentials
nano .env  # or use your preferred editor
```

Required variables:
- `SLACK_BOT_TOKEN` - From Slack app OAuth page
- `SLACK_MONITOR_CHANNELS` - Comma-separated channel IDs
- `POKE_WEBHOOK_URL` - Your Poke endpoint URL
- `CRON_SECRET` - Random secret for securing cron endpoint

### 3. Create Slack App

1. Go to [https://api.slack.com/apps](https://api.slack.com/apps)
2. Click **"Create New App"** → **"From scratch"**
3. Name it **"Poke Integration"** and select your workspace
4. Configure OAuth & Permissions (see detailed instructions below)

### 4. Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Set environment variables in Vercel
vercel env add SLACK_BOT_TOKEN
vercel env add SLACK_MONITOR_CHANNELS
vercel env add POKE_WEBHOOK_URL
vercel env add CRON_SECRET
vercel env add POKE_API_KEY  # if needed

# Deploy
vercel --prod
```

### 5. Configure Slack App (Detailed Steps)

#### OAuth & Permissions

Navigate to **OAuth & Permissions** and add these Bot Token Scopes:

- `channels:history` - Read messages in public channels
- `channels:read` - View basic channel information
- `users:read` - View user information
- `users:read.email` - View user email addresses (optional but recommended)

**Install the app to your workspace** and copy the **Bot User OAuth Token** to your Vercel environment as `SLACK_BOT_TOKEN`.

#### Invite Bot to Channels

For each channel you want to monitor:

1. Open the channel in Slack
2. Type `/invite @Poke Integration` (or whatever you named your app)
3. The bot must be in the channel to read messages

## Usage

### Monitoring Channels

Once deployed, the integration automatically:

1. Polls monitored channels every 5 minutes
2. Fetches new messages since last sync
3. Sends them to Poke webhook
4. Updates state for next sync

### Checking Health

Visit your health check endpoint to verify the integration is working:

```bash
curl https://your-vercel-app.vercel.app/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-17T12:00:00.000Z",
  "configuration": {
    "monitoredChannelsCount": 2,
    "monitoredChannels": ["C1234567890", "C9876543210"],
    "slackConfigured": true,
    "pokeConfigured": true
  }
}
```

### Manual Sync (Testing)

You can manually trigger a sync for testing using either endpoint:

**Option 1: Cron endpoint**
```bash
curl -X POST https://your-app.vercel.app/api/cron/sync \
  -H "Authorization: Bearer your-cron-secret"
```

**Option 2: Trigger endpoint (for external services)**
```bash
curl -X POST https://your-app.vercel.app/api/trigger \
  -H "Authorization: Bearer your-cron-secret"
```

Both endpoints perform the same function - use `/api/trigger` when setting up external cron services.

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SLACK_BOT_TOKEN` | Yes | - | Bot User OAuth Token from Slack app |
| `SLACK_MONITOR_CHANNELS` | Yes | - | Comma-separated channel IDs (e.g., `C123,C456`) |
| `POKE_WEBHOOK_URL` | Yes | - | Poke webhook endpoint URL |
| `CRON_SECRET` | Recommended | - | Secret for authenticating cron requests |
| `POKE_API_KEY` | No | - | Bearer token for Poke authentication |
| `LOG_LEVEL` | No | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `NODE_ENV` | No | `production` | Environment: `development` or `production` |

### Sync Frequency Options

You have two options for running the integration:

#### Option 1: Vercel Daily Cron (Included with Hobby Plan)

Vercel Hobby plan ($20/month) includes daily cron jobs. The integration is configured to run once per day at 7:30 AM.

Configured in `vercel.json`:
```json
{
  "crons": [
    {
      "path": "/api/cron/sync",
      "schedule": "30 7 * * *"  // Every day at 7:30 AM
    }
  ]
}
```

**Pros:**
- ✅ Included with Hobby plan (no extra cost)
- ✅ Automatic, zero maintenance
- ✅ Reliable Vercel infrastructure

**Cons:**
- ⚠️ Limited to once per day
- ⚠️ Fixed schedule (7:30 AM)

**Change the schedule:**
Edit `vercel.json` and redeploy. Cron syntax: `minute hour day month dayofweek`

Examples:
- `0 9 * * *` - Every day at 9:00 AM
- `30 14 * * *` - Every day at 2:30 PM
- `0 9 * * 1-5` - Weekdays at 9:00 AM

#### Option 2: External Trigger (For More Frequent Syncs)

For syncs more than once per day, use an external cron service to trigger the `/api/trigger` endpoint.

**Setup with cron-job.org (Free):**

1. Sign up at https://cron-job.org
2. Create new cron job
3. **URL**: `https://your-app.vercel.app/api/trigger`
4. **Method**: POST
5. **Headers**: Add `Authorization: Bearer YOUR_CRON_SECRET`
6. **Schedule**: Every 5 minutes, hourly, etc.

**Other external services:**
- [EasyCron](https://www.easycron.com/) - Free tier available
- [Cronitor](https://cronitor.io/) - Monitoring + scheduling
- [GitHub Actions](https://github.com/features/actions) - Free for public repos

**Test manually:**
```bash
curl -X POST https://your-app.vercel.app/api/trigger \
  -H "Authorization: Bearer your-cron-secret"
```

**Pros:**
- ✅ Sync as frequently as needed (every 5 min, hourly, etc.)
- ✅ Flexible scheduling
- ✅ Free tier options available

**Cons:**
- ⚠️ Requires external service setup
- ⚠️ One more thing to maintain

### Getting Channel IDs

1. Right-click any channel in Slack
2. Select **"View channel details"**
3. Scroll down - the Channel ID is at the bottom
4. Format: `C1234567890` (public) or `G1234567890` (private)

## Payload Format

The integration sends messages to Poke in the following JSON structure:

```json
{
  "source": "slack",
  "channel": {
    "id": "C1234567890",
    "name": "general",
    "isPrivate": false,
    "topic": "Company-wide discussions",
    "purpose": "Team communication"
  },
  "message": {
    "timestamp": "1234567890.123456",
    "user": {
      "id": "U1234567890",
      "name": "John Doe",
      "email": "john@example.com",
      "avatar": "https://secure.gravatar.com/avatar/...",
      "isBot": false,
      "isAdmin": false
    },
    "text": "What do you think about the new feature?",
    "type": "message",
    "isReply": false,
    "attachments": [],
    "files": [],
    "reactions": [
      {
        "name": "thumbsup",
        "count": 3,
        "users": ["U123", "U456", "U789"]
      }
    ]
  },
  "metadata": {
    "polledAt": "2026-01-17T12:00:00.000Z",
    "integrationVersion": "1.0.0"
  }
}
```

## Local Development

### Running Locally

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your credentials

# Start Vercel dev server
npm run dev
```

The server runs at `http://localhost:3000`

### Testing the Cron Function

With Vercel dev running, trigger the sync manually:

```bash
curl -X POST http://localhost:3000/api/cron/sync \
  -H "Authorization: Bearer your-cron-secret"
```

Check the response for sync results:
```json
{
  "success": true,
  "summary": {
    "channelsPolled": 2,
    "totalMessages": 5,
    "messagesSent": 5,
    "errors": 0
  },
  "duration": 1523
}
```

## State Management

The integration tracks the last processed timestamp for each channel in `/tmp/slack-poke-state.json`. This file:

- Persists across function invocations (within the same instance)
- Resets on cold starts (new Vercel instance)
- Prevents duplicate message processing
- Defaults to 10-minute lookback on first run

### Production State Management

For production with multiple Vercel instances, consider upgrading to a distributed state store:

**Option 1: Vercel KV (Recommended)**
```bash
npm install @vercel/kv
```

**Option 2: Vercel Postgres**
```bash
npm install @vercel/postgres
```

**Option 3: External Redis**
Use any Redis provider (Upstash, Redis Cloud, etc.)

## Troubleshooting

### Messages not being fetched

1. **Check bot is in channel**: Invite with `/invite @YourBot`
2. **Verify channel IDs**: Ensure `SLACK_MONITOR_CHANNELS` is correct
3. **Check Vercel logs**: Run `vercel logs` to see errors
4. **Review OAuth scopes**: Ensure `channels:history` scope is granted

### Cron not triggering

1. **Verify Vercel plan**: Cron requires Hobby or Pro plan
2. **Check vercel.json**: Ensure `crons` array is configured
3. **View cron logs**: Check Vercel dashboard → Deployments → Cron Logs
4. **Test manually**: Use curl to trigger `/api/cron/sync`

### Messages sent to Poke but not appearing

1. **Check Poke endpoint**: Test with `curl -X POST <POKE_WEBHOOK_URL>`
2. **Verify API key**: Ensure `POKE_API_KEY` matches Poke's expectations
3. **Check payload format**: Review Poke's webhook documentation
4. **Review error logs**: Look for retry failures in Vercel logs

### Duplicate messages

1. **State file reset**: Happens on cold starts (normal behavior)
2. **Multiple instances**: Upgrade to distributed state (Vercel KV)
3. **Clock skew**: Ensure system time is synchronized

### Health check fails

- Indicates missing environment variables
- Check Vercel environment configuration: `vercel env ls`
- Redeploy after fixing: `vercel --prod`

## Security

### Best Practices

- ✅ **Never commit** `.env` to version control (already in `.gitignore`)
- ✅ **Set CRON_SECRET** to prevent unauthorized cron triggers
- ✅ **Rotate secrets** regularly (especially if exposed)
- ✅ **Use environment variables** for all secrets
- ✅ **Enable HTTPS only** (enforced by Vercel)
- ✅ **Monitor logs** for suspicious activity

### Cron Authentication

The cron endpoint (`/api/cron/sync`) is protected by a secret token:

```javascript
// Request must include Authorization header
Authorization: Bearer your-cron-secret
```

Set `CRON_SECRET` in Vercel environment variables. Without it, the endpoint is unprotected.

## Monitoring

### Vercel Logs

View real-time logs:

```bash
vercel logs --follow
```

View recent logs:

```bash
vercel logs
```

### Cron Logs

Check cron execution history in Vercel dashboard:
1. Go to your project
2. Click "Deployments"
3. Select "Cron Logs" tab

### Health Endpoint

Monitor service health:

```bash
curl https://your-app.vercel.app/api/health | jq
```

### Metrics to Track

- Messages processed per sync
- Poke webhook success/failure rate
- Sync duration (should be under 10 seconds)
- State file age (time since last sync)

## Limitations

### Current Limitations

- **File-based state**: Resets on cold starts
  - For production, upgrade to Vercel KV or Postgres
- **Message limit**: Fetches up to 1000 messages per sync per channel
- **Rate limits**: Subject to Slack API tier limits (1-100 requests/minute)
- **Cron frequency**: Vercel minimum is 1 minute

### Future Enhancements

- [ ] Vercel KV for distributed state management
- [ ] Support for private channels and DMs
- [ ] Pagination for channels with >1000 messages
- [ ] Admin dashboard for configuration
- [ ] Batch webhook delivery (if Poke supports it)
- [ ] Message filtering rules (exclude bots, system messages, etc.)
- [ ] Per-channel sync frequencies

## Project Structure

```
slack-poke-integration/
├── api/                      # Vercel serverless functions
│   ├── cron/
│   │   └── sync.js          # Scheduled sync function (main entry point)
│   └── health.js            # Health check endpoint
├── lib/                      # Core business logic
│   ├── slack-client.js      # Slack API wrapper
│   ├── message-poller.js    # Message fetching and formatting
│   ├── poke-client.js       # Poke webhook client
│   └── state-manager.js     # Timestamp tracking
├── utils/
│   └── logger.js            # Structured logging
├── config/
│   └── constants.js         # Configuration validation
├── .env.example             # Environment template
├── vercel.json              # Vercel deployment + cron config
├── package.json             # Dependencies and scripts
└── README.md                # This file
```

## Cost Estimates

### Vercel Pricing (Hobby Plan - $20/month)

- Cron: Included (up to 10 cron jobs)
- Function invocations: 100GB-hours included
- Bandwidth: 100GB included
- KV (optional): $0.20 per 100k reads

### Expected Usage

With 5-minute sync and 2 channels:
- Cron executions: ~8,640/month (well within limits)
- Function duration: ~2-5 seconds per sync
- Bandwidth: Minimal (JSON payloads only)

**Estimated cost**: $20/month (Hobby plan)

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues or questions:

1. Check the [Troubleshooting](#troubleshooting) section
2. Review [Vercel logs](#vercel-logs)
3. Check Slack app configuration
4. Open an issue with detailed error logs

## Credits

Built with:
- [Slack Web API](https://api.slack.com/web)
- [Vercel Serverless Functions](https://vercel.com/docs/functions)
- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- Node.js
