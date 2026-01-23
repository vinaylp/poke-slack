# Security Documentation

This document describes the security features, configuration options, and best practices for the Slack MCP Server.

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Input Validation](#input-validation)
- [Access Control](#access-control)
- [Data Privacy](#data-privacy)
- [Configuration Reference](#configuration-reference)
- [Deployment Checklist](#deployment-checklist)
- [Incident Response](#incident-response)

---

## Overview

The Slack MCP Server implements multiple layers of security to protect your Slack workspace data:

| Layer | Protection |
|-------|------------|
| Authentication | Bearer token required for all API requests |
| Rate Limiting | Prevents abuse and brute-force attacks |
| Input Validation | Strict schema validation with Zod |
| Access Control | Restricts access to monitored channels only |
| Data Privacy | Configurable PII exposure (emails disabled by default) |
| Error Handling | Sanitized error messages (no internal details leaked) |

---

## Authentication

### How It Works

All requests to `/api/mcp-http` must include a valid Bearer token in the Authorization header:

```
Authorization: Bearer <your-mcp-auth-token>
```

### Token Requirements

- Minimum recommended length: 32 characters
- Should be cryptographically random
- Must be kept secret and never committed to version control

### Generating a Token

```bash
# Using OpenSSL (recommended)
openssl rand -base64 32

# Using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Using Python
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

### Configuration

Set the token in your environment variables:

```bash
MCP_AUTH_TOKEN=your-secure-random-token-here
```

### Error Responses

| Scenario | HTTP Status | Error Message |
|----------|-------------|---------------|
| Missing header | 401 | Missing Authorization header |
| Invalid format | 401 | Invalid Authorization format. Expected: Bearer <token> |
| Wrong token | 401 | Invalid token |
| Token not configured | 401 | Server misconfiguration |

### Security Features

- **Timing-safe comparison**: Prevents timing attacks that could leak token information
- **Rate limiting before auth**: Prevents brute-force attacks on the token

---

## Rate Limiting

### How It Works

Rate limiting is applied per IP address before authentication, protecting against:
- Brute-force attacks on the auth token
- Denial of service attempts
- Excessive API usage

### Default Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `RATE_LIMIT_MAX` | 60 | Maximum requests per window |
| `RATE_LIMIT_WINDOW_MS` | 60000 | Window duration in milliseconds (1 minute) |

### Response Headers

Every response includes rate limit information:

```
X-RateLimit-Remaining: 59
X-RateLimit-Reset: 45
```

### Rate Limit Exceeded

When the limit is exceeded, the server returns:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32000,
    "message": "Rate limit exceeded. Please try again later."
  }
}
```

HTTP Status: `429 Too Many Requests`

### Customizing Rate Limits

For higher-volume usage, adjust the environment variables:

```bash
# Allow 120 requests per 2 minutes
RATE_LIMIT_MAX=120
RATE_LIMIT_WINDOW_MS=120000
```

---

## Input Validation

All tool parameters are validated using Zod schemas before processing.

### Validation Rules

#### `get_slack_messages`

| Parameter | Type | Validation | Default |
|-----------|------|------------|---------|
| `channel_id` | string | Must match `/^[CG][A-Z0-9]+$/` | (all monitored) |
| `hours` | number | 1-720 (max 30 days) | 24 |
| `limit` | number | 1-200 | 50 |

#### `get_mentions`

| Parameter | Type | Validation | Default |
|-----------|------|------------|---------|
| `user_id` | string | Required, must match `/^U[A-Z0-9]+$/` | - |
| `hours` | number | 1-720 (max 30 days) | 24 |

#### `get_thread`

| Parameter | Type | Validation | Default |
|-----------|------|------------|---------|
| `channel_id` | string | Required, must match `/^[CG][A-Z0-9]+$/` | - |
| `thread_ts` | string | Required, must match `/^\d+\.\d+$/` | - |

### Validation Errors

Invalid input returns a user-friendly error:

```json
{
  "content": [{ "type": "text", "text": "Error: Invalid channel ID format" }],
  "isError": true
}
```

---

## Access Control

### Channel Restrictions

The server only allows access to channels explicitly listed in `SLACK_MONITOR_CHANNELS`:

- `get_slack_messages`: Only fetches from monitored channels
- `get_thread`: Only allows threads from monitored channels
- `get_mentions`: Only searches within monitored channels

Attempting to access non-monitored channels returns:

```json
{
  "content": [{ "type": "text", "text": "Error: Channel not in monitored list" }],
  "isError": true
}
```

### Health Endpoint

The `/api/health` endpoint is intentionally public for monitoring purposes but does NOT expose:
- Channel IDs
- Auth tokens
- User data
- Message content

It only reveals:
- Service health status
- Channel count (not IDs)
- Whether Slack/Auth are configured (boolean)

---

## Data Privacy

### Email Addresses

User email addresses are **disabled by default**. To enable:

```bash
INCLUDE_USER_EMAILS=true
```

When disabled, the `email` field is omitted from user objects in responses.

### File URLs

Private Slack file URLs (`url_private`) are **never included** in responses. Only file metadata is returned:
- File ID
- Filename
- Title
- File type

### What Data Is Returned

| Data Type | Included | Notes |
|-----------|----------|-------|
| Message text | Yes | Required for functionality |
| User ID | Yes | Slack user identifier |
| User name | Yes | Display name |
| User email | **No** (configurable) | Requires `INCLUDE_USER_EMAILS=true` |
| Channel ID | Yes | For context |
| Channel name | Yes | For context |
| Timestamps | Yes | Message timing |
| Reactions | Yes | Emoji reactions |
| File metadata | Yes | Name, type only |
| File URLs | **No** | Security risk |

### Error Messages

Internal errors are sanitized:

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32603,
    "message": "Internal server error"
  }
}
```

No stack traces, file paths, or internal details are exposed.

---

## Configuration Reference

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Slack Bot User OAuth Token (xoxb-...) |
| `SLACK_MONITOR_CHANNELS` | Comma-separated channel IDs |
| `MCP_AUTH_TOKEN` | API authentication token |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `INCLUDE_USER_EMAILS` | `false` | Include emails in responses |
| `RATE_LIMIT_MAX` | `60` | Max requests per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate limit window (ms) |
| `LOG_LEVEL` | `info` | Logging verbosity |
| `NODE_ENV` | `production` | Environment mode |

---

## Deployment Checklist

Before deploying to production, verify:

### Authentication
- [ ] Generated a cryptographically secure `MCP_AUTH_TOKEN` (32+ chars)
- [ ] Token stored securely in Vercel environment variables
- [ ] Token NOT committed to version control
- [ ] Poke configured with the correct token

### Access Control
- [ ] Only necessary channels listed in `SLACK_MONITOR_CHANNELS`
- [ ] Slack bot only invited to monitored channels
- [ ] Verified channel IDs are correct

### Privacy
- [ ] `INCLUDE_USER_EMAILS` is `false` unless explicitly needed
- [ ] Reviewed Slack OAuth scopes (remove `users:read.email` if not needed)

### Monitoring
- [ ] `/api/health` endpoint accessible for uptime monitoring
- [ ] Vercel logs enabled for security monitoring
- [ ] Alerts configured for unusual activity

### Testing
- [ ] Verified unauthenticated requests are rejected (401)
- [ ] Verified rate limiting works (429 after limit)
- [ ] Verified non-monitored channels are blocked
- [ ] Verified error messages don't leak internal details

---

## Incident Response

### If the MCP_AUTH_TOKEN is compromised:

1. **Immediately** generate a new token:
   ```bash
   openssl rand -base64 32
   ```

2. Update the token in Vercel:
   - Go to Project → Settings → Environment Variables
   - Update `MCP_AUTH_TOKEN`
   - Redeploy the application

3. Update Poke with the new token

4. Review Vercel logs for unauthorized access attempts

### If Slack Bot Token is compromised:

1. Go to [Slack API](https://api.slack.com/apps) → Your App → OAuth & Permissions

2. Click "Revoke Token" to invalidate the compromised token

3. Reinstall the app to generate a new token

4. Update `SLACK_BOT_TOKEN` in Vercel

5. Redeploy the application

### Monitoring for Suspicious Activity

Check Vercel logs for:
- Multiple 401 errors from the same IP (brute force attempt)
- 429 rate limit responses (abuse attempt)
- Requests for non-monitored channels (reconnaissance)
- Unusual request patterns or volumes

---

## Security Contact

If you discover a security vulnerability, please report it responsibly by opening a private issue on GitHub or contacting the maintainers directly.

Do NOT publicly disclose security vulnerabilities until they have been addressed.
