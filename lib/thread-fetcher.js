/**
 * Thread Fetcher and Formatter
 *
 * This module is the core business logic of the integration. It orchestrates
 * the process of:
 * 1. Fetching a complete conversation thread from Slack
 * 2. Enriching messages with user and channel information
 * 3. Formatting the data into a structured JSON payload for Poke
 *
 * The formatted output preserves threading context and includes all metadata
 * necessary for understanding the conversation.
 */

const SlackClient = require('./slack-client');
const logger = require('../utils/logger');

/**
 * Thread Fetcher
 *
 * Handles the complete workflow of fetching and formatting Slack threads
 * for delivery to Poke.
 */
class ThreadFetcher {
  /**
   * Initialize the thread fetcher with a Slack client
   */
  constructor() {
    this.slack = new SlackClient();
  }

  /**
   * Fetch a thread and format it for Poke
   *
   * This is the main entry point. It coordinates all the steps needed to
   * transform a Slack thread into a Poke-compatible payload:
   *
   * 1. Fetch all messages in the thread
   * 2. Fetch channel metadata
   * 3. Enrich each message with user information
   * 4. Format into structured JSON
   *
   * @param {string} channelId - The Slack channel ID (e.g., "C1234567890")
   * @param {string} threadTs - The thread timestamp (e.g., "1234567890.123456")
   * @returns {Promise<Object>} Formatted payload ready for Poke webhook
   * @throws {Error} If fetching or formatting fails
   *
   * @example
   * const fetcher = new ThreadFetcher();
   * const payload = await fetcher.fetchAndFormat('C1234567890', '1234567890.123456');
   * // Returns structured JSON payload with thread data
   */
  async fetchAndFormat(channelId, threadTs) {
    logger.info(`Starting thread fetch and format: ${channelId}/${threadTs}`);

    try {
      // Step 1: Fetch all messages in the thread
      // This includes the parent message and all replies
      const messages = await this.slack.getThreadReplies(channelId, threadTs);

      if (!messages || messages.length === 0) {
        throw new Error('Thread has no messages');
      }

      logger.info(`Fetched ${messages.length} messages from thread`);

      // Step 2: Fetch channel metadata
      // This provides context about where the conversation happened
      const channel = await this.slack.getChannelInfo(channelId);

      // Step 3: Enrich messages with user information
      // Process all messages in parallel for better performance
      const enrichedMessages = await Promise.all(
        messages.map(msg => this._enrichMessage(msg))
      );

      // Step 4: Format the complete payload
      const payload = this._formatPayload({
        channel,
        threadTs,
        messages: enrichedMessages
      });

      logger.info('Successfully formatted thread payload');
      return payload;

    } catch (error) {
      logger.error(`Error fetching and formatting thread: ${error.message}`);
      throw error;
    }
  }

  /**
   * Enrich a single message with user information
   *
   * Slack messages contain only a user ID. This method fetches the full user
   * profile to include name, email, and avatar in the final payload.
   *
   * @private
   * @param {Object} message - Raw message object from Slack API
   * @returns {Promise<Object>} Enriched message with user details
   *
   * Message types handled:
   * - Regular messages (type: 'message')
   * - Bot messages (has bot_id instead of user)
   * - System messages (channel_join, etc.)
   */
  async _enrichMessage(message) {
    // Initialize enriched message with core data
    const enriched = {
      timestamp: message.ts,
      text: message.text || '',
      type: message.subtype || 'message',
      attachments: message.attachments || [],
      files: message.files || []
    };

    // Fetch user information if message has a user ID
    // Some messages (like bot messages or system messages) may not have a user
    if (message.user) {
      try {
        const user = await this.slack.getUserInfo(message.user);

        if (user) {
          enriched.user = {
            id: user.id,
            name: user.real_name || user.name,
            email: user.profile?.email || null,
            avatar: user.profile?.image_72 || null,
            // Include additional useful fields
            isBot: user.is_bot || false,
            isAdmin: user.is_admin || false
          };
        } else {
          // User not found (may be deleted)
          enriched.user = {
            id: message.user,
            name: 'Unknown User',
            email: null,
            avatar: null,
            isBot: false,
            isAdmin: false
          };
        }
      } catch (error) {
        logger.warn(`Failed to enrich user ${message.user}:`, error.message);
        // Continue with partial data rather than failing
        enriched.user = {
          id: message.user,
          name: 'Unknown User',
          email: null,
          avatar: null,
          isBot: false,
          isAdmin: false
        };
      }
    } else if (message.bot_id) {
      // Handle bot messages
      enriched.user = {
        id: message.bot_id,
        name: message.username || 'Bot',
        email: null,
        avatar: message.icons?.image_72 || null,
        isBot: true,
        isAdmin: false
      };
    } else {
      // No user information available (system message)
      enriched.user = null;
    }

    // Handle threaded messages - include parent information if available
    if (message.thread_ts && message.thread_ts !== message.ts) {
      enriched.isReply = true;
      enriched.parentTimestamp = message.thread_ts;
    } else {
      enriched.isReply = false;
    }

    // Include reaction information if present
    if (message.reactions) {
      enriched.reactions = message.reactions.map(reaction => ({
        name: reaction.name,
        count: reaction.count,
        users: reaction.users
      }));
    }

    return enriched;
  }

  /**
   * Format the complete payload for Poke webhook
   *
   * Creates a structured JSON object that includes:
   * - Source identification (always 'slack')
   * - Channel metadata
   * - Thread metadata (ID, message count, timestamps)
   * - All enriched messages
   * - Event metadata (when flagged, which emoji)
   *
   * @private
   * @param {Object} data - Object containing channel, threadTs, and messages
   * @returns {Object} Complete formatted payload
   *
   * Output structure:
   * {
   *   source: 'slack',
   *   channel: { id, name },
   *   thread: { id, messageCount, firstMessage, lastMessage },
   *   messages: [...],
   *   metadata: { flaggedAt, emoji }
   * }
   */
  _formatPayload({ channel, threadTs, messages }) {
    // Calculate thread statistics
    const messageCount = messages.length;
    const firstMessage = messages[0]?.timestamp || null;
    const lastMessage = messages[messages.length - 1]?.timestamp || null;

    // Get the emoji used for flagging (from environment or default to 'pushpin')
    const flagEmoji = process.env.SLACK_MONITOR_EMOJI || 'pushpin';

    // Construct the complete payload
    const payload = {
      // Source identification
      source: 'slack',

      // Channel information
      channel: {
        id: channel.id,
        name: channel.name,
        // Include additional context that might be useful
        isPrivate: channel.is_private || false,
        topic: channel.topic?.value || null,
        purpose: channel.purpose?.value || null
      },

      // Thread metadata
      thread: {
        id: threadTs,
        messageCount: messageCount,
        firstMessage: firstMessage,
        lastMessage: lastMessage,
        // Calculate thread duration in seconds
        durationSeconds: firstMessage && lastMessage
          ? parseFloat(lastMessage) - parseFloat(firstMessage)
          : 0
      },

      // All enriched messages
      messages: messages,

      // Event metadata
      metadata: {
        flaggedAt: new Date().toISOString(),
        emoji: flagEmoji,
        // Include integration version for debugging
        integrationVersion: '1.0.0'
      }
    };

    return payload;
  }

  /**
   * Get a summary of a thread without fetching full details
   *
   * Useful for previewing or validating threads before full processing.
   * Fetches only the parent message and basic statistics.
   *
   * @param {string} channelId - The Slack channel ID
   * @param {string} threadTs - The thread timestamp
   * @returns {Promise<Object>} Thread summary
   *
   * @example
   * const summary = await fetcher.getThreadSummary('C123', '1234567890.123456');
   * // Returns: { messageCount: 5, parentText: '...', channel: '...' }
   */
  async getThreadSummary(channelId, threadTs) {
    try {
      const messages = await this.slack.getThreadReplies(channelId, threadTs);
      const channel = await this.slack.getChannelInfo(channelId);

      return {
        messageCount: messages.length,
        parentText: messages[0]?.text || '',
        channelName: channel.name,
        hasAttachments: messages.some(m => m.attachments?.length > 0),
        hasFiles: messages.some(m => m.files?.length > 0)
      };
    } catch (error) {
      logger.error('Error getting thread summary:', error);
      throw error;
    }
  }
}

module.exports = ThreadFetcher;
