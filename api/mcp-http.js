/**
 * MCP Server for Slack Integration (HTTP-based)
 *
 * This endpoint implements a simplified Model Context Protocol (MCP) over HTTP
 * that works with Vercel's serverless architecture.
 *
 * Poke can call this endpoint to get Slack messages using simple HTTP POST requests.
 *
 * Endpoint: /api/mcp-http
 * Protocol: JSON-RPC 2.0 over HTTP
 */

const SlackClient = require('../lib/slack-client');
const { getMonitoredChannels } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Handle MCP JSON-RPC requests over HTTP
 */
module.exports = async (req, res) => {
  logger.info('MCP HTTP endpoint called');

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32600,
        message: 'Method not allowed - use POST',
      },
    });
  }

  // Set headers for JSON-RPC
  res.setHeader('Content-Type', 'application/json');

  try {
    const { method, params, id } = req.body;

    logger.info(`MCP request: ${method}`, { params });

    // Handle different MCP methods
    switch (method) {
      case 'initialize':
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: 'slack-integration',
              version: '1.0.0',
            },
          },
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
                      description: 'Optional: Specific channel ID to fetch from. If not provided, fetches from all monitored channels.',
                    },
                    hours: {
                      type: 'number',
                      description: 'Number of hours to look back (default: 24)',
                      default: 24,
                    },
                    limit: {
                      type: 'number',
                      description: 'Maximum number of messages to return (default: 50)',
                      default: 50,
                    },
                  },
                },
              },
              {
                name: 'get_mentions',
                description: 'Get Slack messages where a specific user is @mentioned. Useful for finding messages that need attention.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    user_id: {
                      type: 'string',
                      description: 'Slack user ID to find mentions for (e.g., U051C2T1KTM)',
                    },
                    hours: {
                      type: 'number',
                      description: 'Number of hours to look back (default: 24)',
                      default: 24,
                    },
                  },
                  required: ['user_id'],
                },
              },
              {
                name: 'get_thread',
                description: 'Get all messages in a specific Slack thread conversation.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    channel_id: {
                      type: 'string',
                      description: 'Channel ID where the thread exists',
                    },
                    thread_ts: {
                      type: 'string',
                      description: 'Thread timestamp (ts) of the parent message',
                    },
                  },
                  required: ['channel_id', 'thread_ts'],
                },
              },
            ],
          },
        });

      case 'tools/call':
        const toolResult = await handleToolCall(params);
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          result: toolResult,
        });

      default:
        return res.status(200).json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`,
          },
        });
    }
  } catch (error) {
    logger.error('MCP HTTP error:', error);
    return res.status(500).json({
      jsonrpc: '2.0',
      error: {
        code: -32603,
        message: error.message,
      },
    });
  }
};

/**
 * Handle tool execution
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
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    logger.error(`Error executing tool ${name}:`, error);
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Get recent Slack messages
 */
async function handleGetSlackMessages(args) {
  const { channel_id, hours = 24, limit = 50 } = args || {};
  const slack = new SlackClient();

  // Determine which channels to fetch from
  const channels = channel_id ? [channel_id] : getMonitoredChannels();

  // Calculate timestamp for lookback period
  const lookbackMs = hours * 60 * 60 * 1000;
  const oldestTimestamp = ((Date.now() - lookbackMs) / 1000).toFixed(6);

  const allMessages = [];

  for (const channelId of channels) {
    try {
      // Fetch messages from Slack
      const result = await slack.client.conversations.history({
        channel: channelId,
        oldest: oldestTimestamp,
        limit: Math.min(limit, 1000),
      });

      if (!result.messages || result.messages.length === 0) {
        continue;
      }

      // Get channel info
      const channel = await slack.getChannelInfo(channelId);

      // Format messages with user enrichment
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
          messages: allMessages.slice(0, limit),
        }, null, 2),
      },
    ],
  };
}

/**
 * Get messages where user is mentioned
 */
async function handleGetMentions(args) {
  const { user_id, hours = 24 } = args || {};

  if (!user_id) {
    throw new Error('user_id is required');
  }

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
        limit: 1000,
      });

      if (!result.messages || result.messages.length === 0) {
        continue;
      }

      // Filter messages that mention the user
      const mentionPattern = new RegExp(`<@${user_id}>`);
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
          mentions,
        }, null, 2),
      },
    ],
  };
}

/**
 * Get thread conversation
 */
async function handleGetThread(args) {
  const { channel_id, thread_ts } = args || {};

  if (!channel_id || !thread_ts) {
    throw new Error('channel_id and thread_ts are required');
  }

  const slack = new SlackClient();

  try {
    // Fetch thread replies
    const result = await slack.client.conversations.replies({
      channel: channel_id,
      ts: thread_ts,
    });

    if (!result.messages || result.messages.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ error: 'Thread not found' }),
          },
        ],
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
            messages: formattedMessages,
          }, null, 2),
        },
      ],
    };
  } catch (error) {
    logger.error(`Error fetching thread ${thread_ts}:`, error);
    throw error;
  }
}

/**
 * Format a Slack message with user enrichment
 */
async function formatMessage(slack, message, channel) {
  const formatted = {
    timestamp: message.ts,
    text: message.text || '',
    type: message.subtype || 'message',
    channel: {
      id: channel.id,
      name: channel.name,
    },
  };

  // Add user information
  if (message.user) {
    try {
      const user = await slack.getUserInfo(message.user);
      if (user) {
        formatted.user = {
          id: user.id,
          name: user.real_name || user.name,
          email: user.profile?.email || null,
        };
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
      count: r.count,
    }));
  }

  // Add files
  if (message.files && message.files.length > 0) {
    formatted.files = message.files.map(f => ({
      id: f.id,
      name: f.name,
      title: f.title,
      filetype: f.filetype,
      url: f.url_private,
    }));
  }

  return formatted;
}
