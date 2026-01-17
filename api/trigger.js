/**
 * Manual Trigger Endpoint (Vercel Serverless Function)
 *
 * This endpoint can be triggered externally to manually sync Slack messages
 * to Poke. It performs the same function as the scheduled cron job but can
 * be called on-demand from external services.
 *
 * Use cases:
 * - Trigger syncs more frequently than Vercel's daily cron limit
 * - Use external cron services (cron-job.org, EasyCron, etc.)
 * - Manual testing and debugging
 * - Webhook-based triggering from other services
 *
 * SECURITY: This endpoint is protected by CRON_SECRET to prevent unauthorized access.
 *
 * Endpoint: POST /api/trigger
 * Authentication: Bearer token in Authorization header
 * Response: JSON with sync results
 */

const MessagePoller = require('../lib/message-poller');
const PokeClient = require('../lib/poke-client');
const { getMonitoredChannels } = require('../config/constants');
const logger = require('../utils/logger');

/**
 * Manual Trigger Handler
 *
 * This function performs the same sync operation as the cron job.
 * It can be called externally with proper authentication.
 *
 * @param {Object} req - Vercel request object
 * @param {Object} res - Vercel response object
 * @returns {Promise<void>}
 */
module.exports = async (req, res) => {
  const startTime = Date.now();

  logger.info('=== Manual trigger endpoint called ===');

  // STEP 1: Only accept POST requests
  if (req.method !== 'POST') {
    logger.warn(`Rejected ${req.method} request to trigger endpoint`);
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'This endpoint only accepts POST requests'
    });
  }

  // STEP 2: Verify authentication
  // Check for Authorization header with Bearer token
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret) {
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      logger.error('Unauthorized trigger request - invalid or missing authorization header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing authorization token'
      });
    }
  } else {
    // No secret configured - log warning but allow (for easier testing)
    logger.warn('CRON_SECRET not configured - endpoint is unprotected!');
  }

  // STEP 3: Perform the sync operation
  try {
    // Get monitored channels from configuration
    const channelIds = getMonitoredChannels();

    if (channelIds.length === 0) {
      logger.warn('No channels configured to monitor');
      return res.status(200).json({
        success: true,
        message: 'No channels to sync',
        duration: Date.now() - startTime
      });
    }

    logger.info(`Syncing ${channelIds.length} channels: ${channelIds.join(', ')}`);

    // Poll channels for new messages
    const poller = new MessagePoller();
    const pollResults = await poller.pollChannels(channelIds);

    logger.info(`Poll complete: ${pollResults.totalMessages} new messages`);

    // Send messages to Poke
    if (pollResults.totalMessages > 0) {
      const sendResults = await sendMessagesToPoke(pollResults.channels);

      logger.info('=== Manual trigger completed successfully ===');

      return res.status(200).json({
        success: true,
        source: 'manual_trigger',
        summary: {
          channelsPolled: channelIds.length,
          totalMessages: pollResults.totalMessages,
          messagesSent: sendResults.successCount,
          errors: pollResults.errors.length + sendResults.errors.length
        },
        channels: pollResults.channels,
        sendResults: sendResults,
        duration: Date.now() - startTime
      });

    } else {
      logger.info('No new messages to send');

      return res.status(200).json({
        success: true,
        source: 'manual_trigger',
        summary: {
          channelsPolled: channelIds.length,
          totalMessages: 0,
          messagesSent: 0,
          errors: pollResults.errors.length
        },
        channels: pollResults.channels,
        duration: Date.now() - startTime
      });
    }

  } catch (error) {
    logger.error('Manual trigger failed:', error);

    return res.status(500).json({
      success: false,
      error: error.message,
      duration: Date.now() - startTime
    });
  }
};

/**
 * Send polled messages to Poke
 *
 * Iterates through all channels' messages and sends them to Poke.
 * Implements error handling to continue processing even if some sends fail.
 *
 * @param {Object} channelResults - Results from polling channels
 * @returns {Promise<Object>} Summary of send results
 */
async function sendMessagesToPoke(channelResults) {
  const pokeClient = new PokeClient();
  const results = {
    successCount: 0,
    failureCount: 0,
    errors: []
  };

  // Process each channel's messages
  for (const [channelId, channelData] of Object.entries(channelResults)) {
    if (!channelData.success || !channelData.messages) {
      continue;
    }

    // Send each message to Poke
    for (const message of channelData.messages) {
      try {
        await pokeClient.sendThread(message);
        results.successCount++;

        logger.debug(`Sent message ${message.message.timestamp} from ${channelId} to Poke`);

      } catch (error) {
        results.failureCount++;
        results.errors.push({
          channelId: channelId,
          messageTimestamp: message.message.timestamp,
          error: error.message
        });

        logger.error(
          `Failed to send message ${message.message.timestamp} from ${channelId}:`,
          error
        );
      }
    }
  }

  logger.info(
    `Poke delivery complete: ${results.successCount} succeeded, ${results.failureCount} failed`
  );

  return results;
}
