/**
 * Slack API Client Wrapper
 *
 * This module provides a clean interface for interacting with the Slack Web API.
 * It wraps the official @slack/web-api client and provides methods specific to
 * our use case: fetching thread messages and enriching them with user/channel data.
 *
 * The Slack Web API uses OAuth 2.0 Bot tokens for authentication. The token
 * should be stored securely in environment variables and never committed to
 * version control.
 */

const { WebClient } = require('@slack/web-api');
const logger = require('../utils/logger');

/**
 * Slack API Client
 *
 * Provides methods for:
 * - Fetching complete conversation threads
 * - Retrieving user information for message enrichment
 * - Retrieving channel metadata
 *
 * All methods include error handling and respect Slack's rate limits.
 */
class SlackClient {
  /**
   * Initialize the Slack Web API client
   *
   * @throws {Error} If SLACK_BOT_TOKEN is not set in environment variables
   */
  constructor() {
    const token = process.env.SLACK_BOT_TOKEN;

    if (!token) {
      throw new Error('SLACK_BOT_TOKEN environment variable is required');
    }

    // Initialize the Slack Web API client
    // This handles authentication, rate limiting, and retries automatically
    this.client = new WebClient(token);

    // Cache for user and channel info to reduce API calls
    // In production, consider using Redis for distributed caching
    this.userCache = new Map();
    this.channelCache = new Map();
  }

  /**
   * Fetch all messages in a conversation thread
   *
   * A thread in Slack is identified by the timestamp (ts) of the parent message.
   * This method fetches the parent message and all replies using the
   * conversations.replies API endpoint.
   *
   * Note: The Slack API returns a maximum of 1000 messages per request.
   * For threads with more messages, pagination would be required.
   *
   * Required Slack OAuth scopes:
   * - channels:history (for public channels)
   * - groups:history (for private channels, if applicable)
   *
   * @param {string} channelId - The channel ID (e.g., "C1234567890")
   * @param {string} threadTs - The timestamp of the thread's parent message (e.g., "1234567890.123456")
   * @returns {Promise<Array>} Array of message objects from Slack API
   * @throws {Error} If the API call fails
   *
   * @example
   * const messages = await slackClient.getThreadReplies('C1234567890', '1234567890.123456');
   * // Returns: [
   * //   { ts: '1234567890.123456', user: 'U123', text: 'Parent message', ... },
   * //   { ts: '1234567891.123456', user: 'U456', text: 'Reply 1', ... },
   * //   ...
   * // ]
   */
  async getThreadReplies(channelId, threadTs) {
    try {
      logger.info(`Fetching thread replies for ${channelId}/${threadTs}`);

      // Call the conversations.replies API
      // This returns all messages in the thread, including the parent
      const result = await this.client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        limit: 1000, // Maximum allowed by Slack API
        inclusive: true // Include the parent message in the results
      });

      logger.info(`Fetched ${result.messages.length} messages from thread`);

      return result.messages;
    } catch (error) {
      logger.error('Error fetching thread replies:', error);

      // Provide more context about common errors
      if (error.data?.error === 'channel_not_found') {
        throw new Error(`Channel ${channelId} not found or bot not invited`);
      } else if (error.data?.error === 'thread_not_found') {
        throw new Error(`Thread ${threadTs} not found in channel ${channelId}`);
      }

      throw error;
    }
  }

  /**
   * Retrieve detailed information about a Slack user
   *
   * Fetches user profile data including name, email, avatar, and other metadata.
   * Results are cached to minimize API calls and improve performance.
   *
   * Required Slack OAuth scopes:
   * - users:read (for basic user info)
   * - users:read.email (for email addresses, optional)
   *
   * @param {string} userId - The user ID (e.g., "U1234567890")
   * @returns {Promise<Object>} User object from Slack API
   * @throws {Error} If the API call fails
   *
   * @example
   * const user = await slackClient.getUserInfo('U1234567890');
   * // Returns: {
   * //   id: 'U1234567890',
   * //   name: 'john.doe',
   * //   real_name: 'John Doe',
   * //   profile: {
   * //     email: 'john@example.com',
   * //     image_72: 'https://...',
   * //     ...
   * //   },
   * //   ...
   * // }
   */
  async getUserInfo(userId) {
    // Check cache first to avoid unnecessary API calls
    if (this.userCache.has(userId)) {
      logger.debug(`Using cached user info for ${userId}`);
      return this.userCache.get(userId);
    }

    try {
      logger.debug(`Fetching user info for ${userId}`);

      // Call the users.info API
      const result = await this.client.users.info({
        user: userId
      });

      // Cache the result for future use
      // Cache entries don't expire in this simple implementation
      // In production, consider adding TTL (time-to-live)
      this.userCache.set(userId, result.user);

      return result.user;
    } catch (error) {
      logger.error(`Error fetching user info for ${userId}:`, error);

      // Return null for missing users instead of throwing
      // This allows processing to continue even if some users are deleted
      if (error.data?.error === 'user_not_found') {
        logger.warn(`User ${userId} not found, returning null`);
        return null;
      }

      throw error;
    }
  }

  /**
   * Retrieve detailed information about a Slack channel
   *
   * Fetches channel metadata including name, topic, purpose, and member count.
   * Results are cached to minimize API calls.
   *
   * Required Slack OAuth scopes:
   * - channels:read (for public channels)
   * - groups:read (for private channels, if applicable)
   *
   * @param {string} channelId - The channel ID (e.g., "C1234567890")
   * @returns {Promise<Object>} Channel object from Slack API
   * @throws {Error} If the API call fails
   *
   * @example
   * const channel = await slackClient.getChannelInfo('C1234567890');
   * // Returns: {
   * //   id: 'C1234567890',
   * //   name: 'general',
   * //   is_channel: true,
   * //   topic: { value: 'Company-wide announcements', ... },
   * //   ...
   * // }
   */
  async getChannelInfo(channelId) {
    // Check cache first
    if (this.channelCache.has(channelId)) {
      logger.debug(`Using cached channel info for ${channelId}`);
      return this.channelCache.get(channelId);
    }

    try {
      logger.debug(`Fetching channel info for ${channelId}`);

      // Call the conversations.info API
      const result = await this.client.conversations.info({
        channel: channelId
      });

      // Cache the result
      this.channelCache.set(channelId, result.channel);

      return result.channel;
    } catch (error) {
      logger.error(`Error fetching channel info for ${channelId}:`, error);

      // Provide more context about common errors
      if (error.data?.error === 'channel_not_found') {
        throw new Error(`Channel ${channelId} not found or bot not invited`);
      }

      throw error;
    }
  }

  /**
   * Clear all caches
   *
   * Useful for testing or when you need to force fresh data from the API.
   * In a serverless environment, caches are automatically cleared between
   * cold starts.
   */
  clearCache() {
    logger.info('Clearing Slack client caches');
    this.userCache.clear();
    this.channelCache.clear();
  }
}

module.exports = SlackClient;
