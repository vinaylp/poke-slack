/**
 * Message Poller
 *
 * This module handles fetching recent messages from monitored Slack channels
 * and formatting them for delivery to Poke.
 *
 * Unlike the previous reaction-based approach, this polls Slack channels
 * at regular intervals to fetch new messages since the last sync.
 *
 * Key features:
 * - Fetches messages since last processed timestamp
 * - Enriches messages with user and channel data
 * - Formats individual messages (not threads)
 * - Handles rate limiting and pagination
 */

const SlackClient = require('./slack-client');
const stateManager = require('./state-manager');
const logger = require('../utils/logger');

/**
 * Message Poller Class
 *
 * Polls Slack channels for new messages and formats them for Poke.
 */
class MessagePoller {
  constructor() {
    this.slack = new SlackClient();
  }

  /**
   * Poll all monitored channels for new messages
   *
   * This is the main entry point called by the cron job.
   * It fetches new messages from each channel since the last sync.
   *
   * @param {Array<string>} channelIds - Array of channel IDs to poll
   * @returns {Promise<Object>} Summary of polling results
   *
   * @example
   * const poller = new MessagePoller();
   * const result = await poller.pollChannels(['C123', 'C456']);
   * // Returns: { totalMessages: 15, channels: {...}, errors: [] }
   */
  async pollChannels(channelIds) {
    logger.info(`Starting poll of ${channelIds.length} channels`);

    const results = {
      totalMessages: 0,
      channels: {},
      errors: []
    };

    // Poll each channel
    for (const channelId of channelIds) {
      try {
        const messages = await this.pollChannel(channelId);

        results.channels[channelId] = {
          messageCount: messages.length,
          messages: messages, // Include the actual formatted messages
          success: true
        };

        results.totalMessages += messages.length;

        logger.info(`Polled ${channelId}: ${messages.length} new messages`);

      } catch (error) {
        logger.error(`Error polling channel ${channelId}:`, error);

        results.channels[channelId] = {
          messageCount: 0,
          messages: [],
          success: false,
          error: error.message
        };

        results.errors.push({
          channelId,
          error: error.message
        });
      }
    }

    logger.info(`Poll complete: ${results.totalMessages} total messages from ${channelIds.length} channels`);

    return results;
  }

  /**
   * Poll a single channel for new messages
   *
   * Fetches messages since the last processed timestamp and returns
   * formatted message objects. Processes messages in batches to handle
   * large volumes efficiently.
   *
   * @param {string} channelId - The Slack channel ID
   * @returns {Promise<Array>} Array of formatted message objects
   */
  async pollChannel(channelId) {
    // Get the last processed timestamp for this channel
    const lastTimestamp = await stateManager.getLastProcessedTimestamp(channelId);

    logger.debug(`Polling ${channelId} since ${lastTimestamp}`);

    // Fetch messages from Slack (with pagination support)
    const rawMessages = await this._fetchMessages(channelId, lastTimestamp);

    if (rawMessages.length === 0) {
      logger.debug(`No new messages in ${channelId}`);
      return [];
    }

    logger.info(`Fetched ${rawMessages.length} messages from ${channelId}`);

    // Get channel info for context
    const channel = await this.slack.getChannelInfo(channelId);

    // Process messages in batches to avoid overwhelming the system
    const BATCH_SIZE = 50; // Process 50 messages at a time
    const formattedMessages = [];

    for (let i = 0; i < rawMessages.length; i += BATCH_SIZE) {
      const batch = rawMessages.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(rawMessages.length / BATCH_SIZE);

      logger.debug(`Processing batch ${batchNumber}/${totalBatches} (${batch.length} messages)`);

      // Format messages in this batch in parallel
      const formattedBatch = await Promise.all(
        batch.map(msg => this._formatMessage(msg, channel))
      );

      formattedMessages.push(...formattedBatch);

      // Small delay between batches to avoid rate limits
      if (i + BATCH_SIZE < rawMessages.length) {
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
      }
    }

    logger.info(`Formatted ${formattedMessages.length} messages from ${channelId}`);

    // Update the last processed timestamp to the newest message
    const newestTimestamp = rawMessages[rawMessages.length - 1].ts;
    await stateManager.setLastProcessedTimestamp(channelId, newestTimestamp);

    return formattedMessages;
  }

  /**
   * Fetch messages from Slack channel since a timestamp
   *
   * Uses the conversations.history API to fetch messages.
   * Handles pagination for large message batches (>1000 messages).
   * Implements rate limit handling with exponential backoff.
   *
   * @private
   * @param {string} channelId - The channel ID
   * @param {string} sinceTimestamp - Fetch messages after this timestamp
   * @returns {Promise<Array>} Raw message objects from Slack API
   */
  async _fetchMessages(channelId, sinceTimestamp) {
    const allMessages = [];
    let cursor = null;
    let pageCount = 0;
    const maxPages = 10; // Safety limit: max 10,000 messages (10 pages * 1000)

    try {
      do {
        pageCount++;

        // Fetch one page of messages with retry logic for rate limits
        const result = await this._fetchMessagesWithRetry({
          channel: channelId,
          oldest: sinceTimestamp,
          limit: 1000, // Maximum allowed by Slack
          inclusive: false, // Don't include message at oldest timestamp (already processed)
          cursor: cursor // Pagination cursor (null for first page)
        });

        // Add messages from this page
        if (result.messages && result.messages.length > 0) {
          allMessages.push(...result.messages);
          logger.debug(`Fetched page ${pageCount}: ${result.messages.length} messages from ${channelId}`);
        }

        // Check if there are more pages
        cursor = result.response_metadata?.next_cursor;

        // Safety check: prevent infinite loops
        if (pageCount >= maxPages) {
          logger.warn(`Reached max pages (${maxPages}) for ${channelId}, stopping pagination`);
          break;
        }

      } while (cursor); // Continue while there's a next page

      logger.info(`Fetched ${allMessages.length} total messages from ${channelId} (${pageCount} page(s))`);

      // Reverse to get chronological order (oldest first)
      const messages = allMessages.reverse();

      // Filter out empty messages
      const filteredMessages = messages.filter(msg => {
        // Skip messages without content
        if (!msg.text && !msg.attachments && !msg.files) {
          return false;
        }
        return true;
      });

      return filteredMessages;

    } catch (error) {
      logger.error(`Error fetching messages from ${channelId}:`, error);

      // Provide context for common errors
      if (error.data?.error === 'channel_not_found') {
        throw new Error(`Channel ${channelId} not found or bot not invited`);
      } else if (error.data?.error === 'not_in_channel') {
        throw new Error(`Bot is not a member of channel ${channelId}. Invite with /invite @bot`);
      } else if (error.data?.error === 'ratelimited') {
        throw new Error(`Rate limited by Slack API for ${channelId}`);
      }

      throw error;
    }
  }

  /**
   * Fetch messages with automatic retry on rate limits
   *
   * Implements exponential backoff for rate limit errors.
   *
   * @private
   * @param {Object} params - Parameters for conversations.history API
   * @param {number} retries - Number of retries remaining
   * @returns {Promise<Object>} API response
   */
  async _fetchMessagesWithRetry(params, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        // Call Slack API
        const result = await this.slack.client.conversations.history(params);
        return result;

      } catch (error) {
        const isRateLimited = error.data?.error === 'ratelimited';
        const isLastAttempt = attempt === retries;

        if (isRateLimited && !isLastAttempt) {
          // Calculate backoff delay (exponential: 2^attempt seconds)
          const delaySeconds = Math.pow(2, attempt);
          logger.warn(`Rate limited, retrying in ${delaySeconds}s (attempt ${attempt}/${retries})`);

          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        } else {
          // Not rate limited, or last attempt failed
          throw error;
        }
      }
    }
  }

  /**
   * Format a single message for Poke
   *
   * Enriches the message with user information and channel context,
   * then formats it into the structure expected by Poke.
   *
   * @private
   * @param {Object} message - Raw message from Slack API
   * @param {Object} channel - Channel object from Slack API
   * @returns {Promise<Object>} Formatted message object
   */
  async _formatMessage(message, channel) {
    // Build base message object
    const formatted = {
      timestamp: message.ts,
      text: message.text || '',
      type: message.subtype || 'message',
      attachments: message.attachments || [],
      files: message.files || []
    };

    // Enrich with user information
    if (message.user) {
      try {
        const user = await this.slack.getUserInfo(message.user);

        if (user) {
          formatted.user = {
            id: user.id,
            name: user.real_name || user.name,
            email: user.profile?.email || null,
            avatar: user.profile?.image_72 || null,
            isBot: user.is_bot || false,
            isAdmin: user.is_admin || false
          };
        } else {
          formatted.user = this._getUnknownUser(message.user);
        }
      } catch (error) {
        logger.warn(`Failed to fetch user ${message.user}:`, error.message);
        formatted.user = this._getUnknownUser(message.user);
      }
    } else if (message.bot_id) {
      // Handle bot messages
      formatted.user = {
        id: message.bot_id,
        name: message.username || 'Bot',
        email: null,
        avatar: message.icons?.image_72 || null,
        isBot: true,
        isAdmin: false
      };
    } else {
      formatted.user = null;
    }

    // Handle threaded messages
    if (message.thread_ts && message.thread_ts !== message.ts) {
      formatted.isReply = true;
      formatted.parentTimestamp = message.thread_ts;
    } else {
      formatted.isReply = false;
    }

    // Include reactions if present
    if (message.reactions) {
      formatted.reactions = message.reactions.map(reaction => ({
        name: reaction.name,
        count: reaction.count,
        users: reaction.users
      }));
    }

    // Build complete payload with channel context
    return {
      source: 'slack',
      channel: {
        id: channel.id,
        name: channel.name,
        isPrivate: channel.is_private || false,
        topic: channel.topic?.value || null,
        purpose: channel.purpose?.value || null
      },
      message: formatted,
      metadata: {
        polledAt: new Date().toISOString(),
        integrationVersion: '1.0.0'
      }
    };
  }

  /**
   * Create placeholder user object for unknown users
   *
   * @private
   * @param {string} userId - The user ID
   * @returns {Object} Placeholder user object
   */
  _getUnknownUser(userId) {
    return {
      id: userId,
      name: 'Unknown User',
      email: null,
      avatar: null,
      isBot: false,
      isAdmin: false
    };
  }

  /**
   * Get summary statistics about recent polling activity
   *
   * Useful for monitoring and debugging.
   *
   * @param {Array<string>} channelIds - Channels to check
   * @returns {Promise<Object>} Statistics object
   */
  async getStats(channelIds) {
    const stats = {
      channels: {},
      lastPolled: new Date().toISOString()
    };

    for (const channelId of channelIds) {
      try {
        const lastTimestamp = await stateManager.getLastProcessedTimestamp(channelId);
        const lastProcessedDate = new Date(parseFloat(lastTimestamp) * 1000);

        stats.channels[channelId] = {
          lastProcessedTimestamp: lastTimestamp,
          lastProcessedDate: lastProcessedDate.toISOString(),
          minutesSinceLastPoll: Math.floor((Date.now() - lastProcessedDate.getTime()) / 1000 / 60)
        };
      } catch (error) {
        stats.channels[channelId] = {
          error: error.message
        };
      }
    }

    return stats;
  }
}

module.exports = MessagePoller;
