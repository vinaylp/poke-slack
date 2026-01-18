# Slack MCP Server for Poke

A lightweight Model Context Protocol (MCP) server that enables Poke to pull Slack messages for AI-powered inbox triage. Built with Node.js and deployed on Vercel.

## Overview

This MCP server acts as a bridge between Slack and Poke, allowing Poke's AI to intelligently triage Slack messages alongside your emails. Perfect for teams working across different timezones who need to stay on top of important Slack conversations.

## Features

- **MCP Protocol** - Modern pull-based integration using Model Context Protocol
- **On-Demand Fetching** - Poke pulls messages when needed (no polling or webhooks)
- **Multi-Channel Monitoring** - Monitor multiple Slack channels simultaneously
- **Rich Context** - Enriches messages with user info (name, email, avatar) and channel context
- **Smart Filtering** - Poke's AI learns to surface important messages and filter noise
- **Thread-Aware** - Retrieves complete thread conversations with full context
- **Serverless** - Deployed on Vercel with zero infrastructure management

## Architecture

```
Poke (AI Inbox)
    ↓
    [Pulls on-demand via MCP]
    ↓
MCP Server (Vercel Serverless)
    ↓
Slack API
    ↓
Your Slack Channels
```

### How It Works

1. **Poke connects** to the MCP server when checking for updates
2. **MCP server** fetches recent messages from monitored Slack channels
3. **Messages are enriched** with user and channel metadata
4. **Poke's AI** triages messages alongside emails
5. **You get notified** via iMessage for important items

### Checking Schedule

Poke pulls Slack messages:
- During morning briefing (~7:30 AM)
- Every 3-4 hours throughout the day
- Immediately when you ask Poke to check
- Instantly for high-priority messages (@mentions, urgent keywords)

## Quick Start

### Prerequisites

- **Slack workspace** with admin access
- **Poke account** (https://poke.com)
- **Vercel account** (free Hobby plan works)
- **Node.js 18+** for local development (optional)

### 1. Clone and Install

```bash
git clone https://github.com/vinaylp/poke-slack.git
cd poke-slack
npm install
```

### 2. Create Slack App

1. Go to https://api.slack.com/apps
2. Click **"Create New App"** → **"From scratch"**
3. Name it (e.g., "Poke Integration") and select your workspace
4. Navigate to **OAuth & Permissions** and add these Bot Token Scopes:
   - `channels:history` - Read public channel messages
   - `channels:read` - View channel information
   - `users:read` - View user information
   - `users:read.email` - View user email addresses
5. **Install to Workspace** and copy the **Bot User OAuth Token**

### 3. Deploy to Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Set environment variables
vercel env add SLACK_BOT_TOKEN        # Your Bot OAuth Token
vercel env add SLACK_MONITOR_CHANNELS # Comma-separated channel IDs (e.g., C123,C456)

# Deploy to production
vercel --prod
```

### 4. Get Channel IDs

For each channel you want to monitor:

1. Right-click the channel in Slack
2. Select **"View channel details"**
3. Scroll to bottom and copy the **Channel ID** (starts with C...)
4. Add all channel IDs to `SLACK_MONITOR_CHANNELS`, comma-separated

### 5. Invite Bot to Channels

In each monitored channel, type:

```
/invite @YourBotName
```

### 6. Connect to Poke

1. Open Poke app
2. Go to **Integrations** → **Custom Integrations**
3. Click **"Create"**
4. Enter:
   - **Name**: `Slack`
   - **Server URL**: `https://your-app.vercel.app/api/mcp-http`
   - **API Key**: Leave empty
5. Click **"Create Integration"**

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | Yes | Bot User OAuth Token from Slack app |
| `SLACK_MONITOR_CHANNELS` | Yes | Comma-separated channel IDs (e.g., `C123,C456,C789`) |
| `LOG_LEVEL` | No | Logging level: `debug`, `info`, `warn`, `error` (default: `info`) |

### Monitored Channels

To add/remove channels:

1. Get channel IDs (right-click channel → View details)
2. Update `SLACK_MONITOR_CHANNELS` in Vercel
3. Invite/remove bot from channels
4. Ask Poke to refresh connection

## MCP Tools

The server exposes three tools via Model Context Protocol:

### 1. get_slack_messages

Fetches recent messages from monitored channels.

**Parameters:**
- `channel_id` (optional) - Specific channel to fetch from
- `hours` (optional) - Lookback period in hours (default: 24)
- `limit` (optional) - Max messages to return (default: 50)

**Returns:** Array of enriched messages with user and channel context

### 2. get_mentions

Finds messages where a specific user is @mentioned.

**Parameters:**
- `user_id` (required) - Slack user ID to search for
- `hours` (optional) - Lookback period in hours (default: 24)

**Returns:** Array of messages containing @mentions

### 3. get_thread

Retrieves complete thread conversation.

**Parameters:**
- `channel_id` (required) - Channel containing the thread
- `thread_ts` (required) - Thread timestamp

**Returns:** All messages in the thread with full context

## Message Format

Messages are returned in this structure:

```json
{
  "timestamp": "1234567890.123456",
  "text": "Message content...",
  "type": "message",
  "channel": {
    "id": "C08HALVARL0",
    "name": "general"
  },
  "user": {
    "id": "U051C2T1KTM",
    "name": "John Doe",
    "email": "john@example.com"
  },
  "is_reply": false,
  "reactions": [
    { "name": "thumbsup", "count": 3 }
  ],
  "files": [
    { "id": "F123", "name": "document.pdf", "filetype": "pdf" }
  ]
}
```

## Poke Integration Tips

### Optimize Filtering

Tell Poke how to prioritize your Slack messages:

```
Monitor these channels:
- #general: Company announcements (HIGH priority)
- #path-ai: Team discussions (HIGHEST - surface @mentions and approvals)
- #path-ai-leads: User conversations (MEDIUM - filter dev testing, surface real prospects)
- #loops-notifications: Signups (MEDIUM - prioritize business domains)

Key people: Sammy (CTO), board members
Urgent keywords: "urgent", "approve", "review needed", "blocking"
```

### Morning Briefing

Poke will batch overnight messages from your team (perfect for timezone differences):

```
Overnight Slack Activity:
━━━━━━━━━━━━━━━━━━━━━━
🔴 URGENT
- @Vinay in #path-ai: "Need approval on new feature"

⚠️ IMPORTANT
- Real user conversation in #path-ai-leads
- Board discussion in #path-ai

ℹ️ FYI
- 3 new signups in #loops-notifications
```

## Project Structure

```
v40/
├── api/
│   ├── health.js        # Health check endpoint
│   └── mcp-http.js      # MCP server (main entry point)
├── lib/
│   └── slack-client.js  # Slack API wrapper
├── config/
│   └── constants.js     # Configuration validation
├── utils/
│   └── logger.js        # Logging utilities
├── index.html           # Status dashboard
├── vercel.json          # Vercel configuration
└── package.json         # Dependencies
```

## Monitoring

### Health Check

Visit your health endpoint to verify the integration:

```bash
curl https://your-app.vercel.app/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-01-17T12:00:00.000Z",
  "configuration": {
    "monitoredChannelsCount": 4,
    "monitoredChannels": ["C08HALVARL0", "C0519827Y05", ...],
    "slackConfigured": true
  }
}
```

### Dashboard

Visit the homepage for a visual dashboard:

```
https://your-app.vercel.app/
```

Shows:
- MCP server status
- Number of monitored channels
- Slack connection status
- Available MCP tools

### Vercel Logs

Monitor server activity:

```bash
vercel logs --follow
```

## Troubleshooting

### Messages not appearing in Poke

1. **Check Poke integration status** - Refresh connection in Poke settings
2. **Verify bot is in channels** - `/invite @YourBot` in each channel
3. **Check Vercel logs** - `vercel logs` for errors
4. **Test health endpoint** - Should return `"status": "healthy"`

### "Bot is not a member of channel" error

The bot hasn't been invited to the channel:

```
/invite @YourBotName
```

in the Slack channel.

### Poke not checking frequently enough

Poke controls checking frequency. You can:
- Ask Poke explicitly: "Check my Slack messages now"
- Configure Poke's checking preferences
- Use @mentions and urgent keywords for immediate alerts

### Environment variables not updating

After changing environment variables in Vercel:

1. Trigger a new deployment (push a commit)
2. Or redeploy manually in Vercel dashboard

## Security

- ✅ **No webhooks** - Pull-based MCP architecture (no exposed endpoints)
- ✅ **Slack OAuth** - Secure token-based authentication
- ✅ **Environment variables** - All secrets stored securely in Vercel
- ✅ **HTTPS only** - Enforced by Vercel
- ✅ **Minimal permissions** - Bot only has read access to invited channels

## Cost

**Free** with Vercel Hobby plan ($0/month):
- Unlimited function invocations
- Serverless MCP server
- Zero infrastructure management

**Optional:**
- Vercel Pro ($20/month) - For team features
- Poke subscription ($20/month) - For AI inbox features

## Use Cases

### CEO Managing Remote Team

- Monitor team channels across timezones
- Never miss @mentions while sleeping
- Get AI-filtered summaries in morning briefing
- Respond to urgent items via iMessage

### Customer Success

- Track support channels for escalations
- Monitor customer feedback channels
- Get notified of VIP customer mentions
- Surface high-priority tickets

### Product Team

- Watch user feedback channels
- Track bug reports and feature requests
- Monitor beta tester conversations
- Filter signal from noise automatically

## Contributing

Contributions welcome! This is a personal project but open to improvements.

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - feel free to use and modify for your own needs.

## Support

- **Issues**: https://github.com/vinaylp/poke-slack/issues
- **Poke**: https://poke.com
- **Slack API**: https://api.slack.com/docs

## Credits

Built with:
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Slack Web API](https://api.slack.com/web)
- [Vercel Serverless Functions](https://vercel.com/docs/functions)
- [Poke](https://poke.com) - AI-powered inbox

---

**Live Example**: https://poke-slack.vercel.app/
