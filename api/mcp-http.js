/**
 * MCP Server for Slack Integration (HTTP-based)
 *
 * This endpoint implements a simplified Model Context Protocol (MCP) over HTTP
 * that works with Vercel's serverless architecture.
 *
 * SECURITY FEATURES:
 * - Bearer token authentication (MCP_AUTH_TOKEN)
 * - Rate limiting per IP
 * - Input validation with Zod
 * - Channel access restrictions
 * - Sanitized error messages
 *
 * Endpoint: /api/mcp-http
 * Protocol: JSON-RPC 2.0 over HTTP
 */

const { z } = require('zod');
const SlackClient = require('../lib/slack-client');
const { getMonitoredChannels, getMcpAuthToken, getRateLimitConfig, includeUserEmails } = require('../config/constants');
const logger = require('../utils/logger');

// ============================================================================
// RATE LIMITING
// ============================================================================

// In-memory rate limit store (resets on cold start, which is acceptable for serverless)
const rateLimitStore = new Map();

/**
 * Check if request should be rate limited
 * @param {string} clientId - Client identifier (IP or token hash)
 * @returns {Object} { allowed: boolean, remaining: number, resetIn: number }
 */
function checkRateLimit(clientId) {
  const config = getRateLimitConfig();
  const now = Date.now();

  let record = rateLimitStore.get(clientId);

  // Clean up old record or create new one
  if (!record || now > record.windowStart + config.windowMs) {
    record = { windowStart: now, count: 0 };
  }

  record.count++;
  rateLimitStore.set(clientId, record);

  const remaining = Math.max(0, config.maxRequests - record.count);
  const resetIn = Math.max(0, record.windowStart + config.windowMs - now);

  return {
    allowed: record.count <= config.maxRequests,
    remaining,
    resetIn
  };
}

// ============================================================================
// INPUT VALIDATION SCHEMAS
// ============================================================================

const GetSlackMessagesSchema = z.object({
  channel_id: z.string().regex(/^[CG][A-Z0-9]+$/, 'Invalid channel ID format').optional(),
  hours: z.number().min(1).max(720).default(24),  // Max 30 days
  limit: z.number().min(1).max(200).default(50)   // Cap at 200
}).optional().default({});

const GetMentionsSchema = z.object({
  user_id: z.string().regex(/^U[A-Z0-9]+$/, 'Invalid user ID format'),
  hours: z.number().min(1).max(720).default(24)
});

const GetThreadSchema = z.object({
  channel_id: z.string().regex(/^[CG][A-Z0-9]+$/, 'Invalid channel ID format'),
  thread_ts: z.string().regex(/^\d+\.\d+$/, 'Invalid thread timestamp format')
});

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Validate bearer token authentication
 * @param {Object} req - Request object
 * @returns {Object} { authenticated: boolean, error?: string }
 */
function authenticateRequest(req) {
  const authHeader = req.headers.authorization;
  const expectedToken = getMcpAuthToken();

  if (!expectedToken) {
    logger.error('MCP_AUTH_TOKEN not configured');
    return { authenticated: false, error: 'Server misconfiguration' };
  }

  if (!authHeader) {
    return { authenticated: false, error: 'Missing Authorization header' };
  }

  if (!authHeader.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Invalid Authorization format. Expected: Bearer <token>' };
  }

  const providedToken = authHeader.slice(7);

  // Use timing-safe comparison to prevent timing attacks
  if (providedToken.length !== expectedToken.length) {
    return { authenticated: false, error: 'Invalid token' };
  }

  // Simple constant-time comparison
  let mismatch = 0;
  for (let i = 0; i < providedToken.length; i++) {
    mismatch |= providedToken.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  }

  if (mismatch !== 0) {
    return { authenticated: false, error: 'Invalid token' };
  }

  return { authenticated: true };
}

// ============================================================================
// MAIN HANDLER
// ============================================================================

/**
 * Handle MCP JSON-RPC requests over HTTP
 */
module.exports = async (req, res) => {
  // Get client identifier for rate limiting
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
                   req.headers['x-real-ip'] ||
                   'unknown';

  // Check rate limit BEFORE authentication (prevents auth brute force)
  const rateLimit = checkRateLimit(clientIp);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
  res.setHeader('X-RateLimit-Reset', Math.ceil(rateLimit.resetIn / 1000));

  if (!rateLimit.allowed) {
    logger.warn(`Rate limit exceeded for ${clientIp}`);
    return res.status(429).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Rate limit exceeded. Please try again later.'
      }
    });
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Method not allowed - use POST'
      }
    });
  }

  // Authenticate request
  const auth = authenticateRequest(req);
  if (!auth.authenticated) {
    logger.warn(`Authentication failed for ${clientIp}: ${auth.error}`);
    return res.status(401).json({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: auth.error
      }
    });
  }

  // Set headers for JSON-RPC
  res.setHeader('Content-Type', 'application/json');

  try {
    const { method, params, id } = req.body;

    logger.info(`MCP request: ${method}`);

    // Handle different MCP methods
    switch (method) {
      case 'initialize':
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {}
            },
            serverInfo: {
              name: 'slack-integration',
              version: '1.0.0',
              icon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNzAgMjcwIj48cGF0aCBmaWxsPSIjRTAxRTVBIiBkPSJNOTkuNCAwYy0xMy4zIDAtMjQgMTAuNy0yNCwyNHMxMC43LDI0LDI0LDI0aDI0VjI0YzAtMTMuMy0xMC43LTI0LTI0LTI0ek05OS40LDY0SDI0QzEwLjcsNjQsMCw3NC43LDAsODhzMTAuNywyNCwyNCwyNGg3NS40YzEzLjMsMCwyNC0xMC43LDI0LTI0UzExMi43LDY0LDk5LjQsNjR6Ii8+PHBhdGggZmlsbD0iIzM2QzVGMCIgZD0iTTI0Niw5OS40YzAtMTMuMy0xMC43LTI0LTI0LTI0cy0yNCwxMC43LTI0LDI0djI0aDI0QzIzNS4zLDEyMy40LDI0NiwxMTIuNywyNDYsOTkuNHogTTE4Mi4yLDk5LjRWMjRjMC0xMy4zLTEwLjctMjQtMjQtMjRzLTI0LDEwLjctMjQsMjR2NzUuNGMwLDEzLjMsMTAuNywyNCwyNCwyNFMxODIuMiwxMTIuNywxODIuMiw5OS40eiIvPjxwYXRoIGZpbGw9IiMyRUI2N0QiIGQ9Ik0xNzAuNiwyNzBjMTMuMywwLDI0LTEwLjcsMjQtMjRzLTEwLjctMjQtMjQtMjRoLTI0djI0QzE0Ni42LDI1OS4zLDE1Ny4zLDI3MCwxNzAuNiwyNzB6IE0xNzAuNiwyMDZoNzUuNGMxMy4zLDAsMjQtMTAuNywyNC0yNHMtMTAuNy0yNC0yNC0yNGgtNzUuNGMtMTMuMywwLTI0LDEwLjctMjQsMjRTMTU3LjMsMjA2LDE3MC42LDIwNnoiLz48cGF0aCBmaWxsPSIjRUNCMjJFIiBkPSJNMjQsMTcwLjZjMCwxMy4zLDEwLjcsMjQsMjQsMjRzMjQtMTAuNywyNC0yNHYtMjRINDhDMzQuNywxNDYuNiwyNCwxNTcuMywyNCwxNzAuNnogTTg3LjgsMTcwLjZWMjQ2YzAsMTMuMywxMC43LDI0LDI0LDI0czI0LTEwLjcsMjQtMjR2LTc1LjRjMC0xMy4zLTEwLjctMjQtMjQtMjRTODcuOCwxNTcuMyw4Ny44LDE3MC42eiIvPjwvc3ZnPg=='
            }
          }
        });

      case 'tools/list':
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            tools: [
              {
                name: 'get_slack_messages',
                description: 'Get recent Slack messages from monitored channels. Returns messages from the last 24 hours by default.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    channel_id: {
                      type: 'string',
                      description: 'Optional: Specific channel ID to fetch from (must be a monitored channel). If not provided, fetches from all monitored channels.'
                    },
                    hours: {
                      type: 'number',
                      description: 'Number of hours to look back (default: 24, max: 720)',
                      default: 24
                    },
                    limit: {
                      type: 'number',
                      description: 'Maximum number of messages to return (default: 50, max: 200)',
                      default: 50
                    }
                  }
                }
              },
              {
                name: 'get_mentions',
                description: 'Get Slack messages where a specific user is @mentioned. Useful for finding messages that need attention.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    user_id: {
                      type: 'string',
                      description: 'Slack user ID to find mentions for (e.g., U051C2T1KTM)'
                    },
                    hours: {
                      type: 'number',
                      description: 'Number of hours to look back (default: 24, max: 720)',
                      default: 24
                    }
                  },
                  required: ['user_id']
                }
              },
              {
                name: 'get_thread',
                description: 'Get all messages in a specific Slack thread conversation (must be in a monitored channel).',
                inputSchema: {
                  type: 'object',
                  properties: {
                    channel_id: {
                      type: 'string',
                      description: 'Channel ID where the thread exists (must be a monitored channel)'
                    },
                    thread_ts: {
                      type: 'string',
                      description: 'Thread timestamp (ts) of the parent message'
                    }
                  },
                  required: ['channel_id', 'thread_ts']
                }
              }
            ]
          }
        });

      case 'tools/call':
        const toolResult = await handleToolCall(params);
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: toolResult
        });

      default:
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: 'Method not found'
          }
        });
    }
  } catch (error) {
    logger.error('MCP HTTP error:', error);
    // Return sanitized error message
    return res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: 'Internal server error'
      }
    });
  }
};

// ============================================================================
// TOOL HANDLERS
// ============================================================================

/**
 * Handle tool execution with validation
 */
async function handleToolCall(params) {
  const { name, arguments: args } = params;

  try {
    switch (name) {
      case 'get_slack_messages':
        return await handleGetSlackMessages(args);

      case 'get_mentions':
        return await handleGetMentions(args);

      case 'get_thread':
        return await handleGetThread(args);

      default:
        return {
          content: [{ type: 'text', text: 'Unknown tool' }],
          isError: true
        };
    }
  } catch (error) {
    logger.error(`Error executing tool ${name}:`, error);

    // Return user-friendly error without exposing internals
    const userMessage = error.isValidationError
      ? error.message
      : 'An error occurred while processing your request';

    return {
      content: [{ type: 'text', text: `Error: ${userMessage}` }],
      isError: true
    };
  }
}

/**
 * Get recent Slack messages with validation
 */
async function handleGetSlackMessages(args) {
  // Validate input
  const parseResult = GetSlackMessagesSchema.safeParse(args);
  if (!parseResult.success) {
    const error = new Error(parseResult.error.errors[0]?.message || 'Invalid input');
    error.isValidationError = true;
    throw error;
  }

  const { channel_id, hours, limit } = parseResult.data;
  const slack = new SlackClient();
  const monitoredChannels = getMonitoredChannels();

  // Validate channel access - ONLY allow monitored channels
  let channels;
  if (channel_id) {
    if (!monitoredChannels.includes(channel_id)) {
      const error = new Error('Channel not in monitored list');
      error.isValidationError = true;
      throw error;
    }
    channels = [channel_id];
  } else {
    channels = monitoredChannels;
  }

  // Calculate timestamp for lookback period
  const lookbackMs = hours * 60 * 60 * 1000;
  const oldestTimestamp = ((Date.now() - lookbackMs) / 1000).toFixed(6);

  const allMessages = [];

  for (const channelId of channels) {
    try {
      const result = await slack.client.conversations.history({
        channel: channelId,
        oldest: oldestTimestamp,
        limit: Math.min(limit, 200)
      });

      if (!result.messages || result.messages.length === 0) {
        continue;
      }

      const channel = await slack.getChannelInfo(channelId);

      for (const msg of result.messages.slice(0, limit)) {
        const formattedMessage = await formatMessage(slack, msg, channel);
        allMessages.push(formattedMessage);
      }
    } catch (error) {
      logger.error(`Error fetching messages from ${channelId}:`, error);
    }
  }

  // Sort by timestamp (most recent first)
  allMessages.sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          total: allMessages.length,
          messages: allMessages.slice(0, limit)
        }, null, 2)
      }
    ]
  };
}

/**
 * Get messages where user is mentioned with validation
 */
async function handleGetMentions(args) {
  // Validate input
  const parseResult = GetMentionsSchema.safeParse(args);
  if (!parseResult.success) {
    const error = new Error(parseResult.error.errors[0]?.message || 'Invalid input');
    error.isValidationError = true;
    throw error;
  }

  const { user_id, hours } = parseResult.data;

  const slack = new SlackClient();
  const channels = getMonitoredChannels();

  const lookbackMs = hours * 60 * 60 * 1000;
  const oldestTimestamp = ((Date.now() - lookbackMs) / 1000).toFixed(6);

  const mentions = [];

  for (const channelId of channels) {
    try {
      const result = await slack.client.conversations.history({
        channel: channelId,
        oldest: oldestTimestamp,
        limit: 1000
      });

      if (!result.messages || result.messages.length === 0) {
        continue;
      }

      // Filter messages that mention the user (escape user_id for regex safety)
      const escapedUserId = user_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const mentionPattern = new RegExp(`<@${escapedUserId}>`);
      const mentionedMessages = result.messages.filter(msg =>
        msg.text && mentionPattern.test(msg.text)
      );

      if (mentionedMessages.length === 0) {
        continue;
      }

      const channel = await slack.getChannelInfo(channelId);

      for (const msg of mentionedMessages) {
        const formattedMessage = await formatMessage(slack, msg, channel);
        mentions.push(formattedMessage);
      }
    } catch (error) {
      logger.error(`Error searching mentions in ${channelId}:`, error);
    }
  }

  // Sort by timestamp (most recent first)
  mentions.sort((a, b) => parseFloat(b.timestamp) - parseFloat(a.timestamp));

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          user_id,
          total: mentions.length,
          mentions
        }, null, 2)
      }
    ]
  };
}

/**
 * Get thread conversation with validation
 */
async function handleGetThread(args) {
  // Validate input
  const parseResult = GetThreadSchema.safeParse(args);
  if (!parseResult.success) {
    const error = new Error(parseResult.error.errors[0]?.message || 'Invalid input');
    error.isValidationError = true;
    throw error;
  }

  const { channel_id, thread_ts } = parseResult.data;

  // SECURITY: Only allow threads from monitored channels
  const monitoredChannels = getMonitoredChannels();
  if (!monitoredChannels.includes(channel_id)) {
    const error = new Error('Channel not in monitored list');
    error.isValidationError = true;
    throw error;
  }

  const slack = new SlackClient();

  try {
    const result = await slack.client.conversations.replies({
      channel: channel_id,
      ts: thread_ts
    });

    if (!result.messages || result.messages.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Thread not found' })
          }
        ]
      };
    }

    const channel = await slack.getChannelInfo(channel_id);

    const formattedMessages = [];
    for (const msg of result.messages) {
      const formattedMessage = await formatMessage(slack, msg, channel);
      formattedMessages.push(formattedMessage);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            channel_id,
            thread_ts,
            total: formattedMessages.length,
            messages: formattedMessages
          }, null, 2)
        }
      ]
    };
  } catch (error) {
    logger.error(`Error fetching thread ${thread_ts}:`, error);
    throw error;
  }
}

// ============================================================================
// MESSAGE FORMATTING
// ============================================================================

/**
 * Format a Slack message with user enrichment
 * Respects INCLUDE_USER_EMAILS configuration
 */
async function formatMessage(slack, message, channel) {
  const formatted = {
    timestamp: message.ts,
    text: message.text || '',
    type: message.subtype || 'message',
    channel: {
      id: channel.id,
      name: channel.name
    }
  };

  // Add user information
  if (message.user) {
    try {
      const user = await slack.getUserInfo(message.user);
      if (user) {
        formatted.user = {
          id: user.id,
          name: user.real_name || user.name
        };

        // Only include email if explicitly enabled
        if (includeUserEmails() && user.profile?.email) {
          formatted.user.email = user.profile.email;
        }
      }
    } catch (error) {
      logger.warn(`Failed to fetch user ${message.user}:`, error.message);
    }
  }

  // Add thread information
  if (message.thread_ts && message.thread_ts !== message.ts) {
    formatted.is_reply = true;
    formatted.thread_ts = message.thread_ts;
  }

  // Add reactions
  if (message.reactions) {
    formatted.reactions = message.reactions.map(r => ({
      name: r.name,
      count: r.count
    }));
  }

  // Add files (metadata only, not private URLs)
  if (message.files && message.files.length > 0) {
    formatted.files = message.files.map(f => ({
      id: f.id,
      name: f.name,
      title: f.title,
      filetype: f.filetype
      // Removed: url: f.url_private (security risk)
    }));
  }

  return formatted;
}
