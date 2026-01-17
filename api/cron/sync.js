/**
 * Scheduled Sync Cron Job (Vercel Serverless Function)
 *
 * This function is triggered on a schedule by Vercel Cron to automatically
 * poll monitored Slack channels and send new messages to Poke.
 *
 * Workflow:
 * 1. Authenticate the cron request (Vercel authorization header)
 * 2. Get list of monitored channels from configuration
 * 3. Poll each channel for new messages since last sync
 * 4. Format each message for Poke
 * 5. Send messages to Poke webhook
 * 6. Update state with latest timestamps
 *
 * Vercel Cron Configuration:
 * - Configured in vercel.json
 * - Runs on a schedule (e.g., every 5 minutes)
 * - Includes authorization header for security
 *
 * Endpoint: POST /api/cron/sync
 * Authentication: Vercel Cron authorization header
 */

const MessagePoller = require('../../lib/message-poller');
const PokeClient = require('../../lib/poke-client');
const { getMonitoredChannels } = require('../../config/constants');
const logger = require('../../utils/logger');

/**
 * Cron Job Handler
 *
 * This function is invoked by Vercel Cron at the configured interval.
 * It must complete within the Vercel function timeout (default 10 seconds
 * for Hobby plan, up to 60 seconds for Pro).
 *
 * @param {Object} req - Vercel request object
 * @param {Object} res - Vercel response object
 * @returns {Promise<void>}
 */
module.exports = async (req, res) => {
  const startTime = Date.now();

  logger.info('=== Cron sync job started ===');

  // SECURITY: Verify this request comes from Vercel Cron
  // Vercel Cron sends requests with an authorization header
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  // If CRON_SECRET is configured, verify it matches
  if (cronSecret) {
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      logger.error('Unauthorized cron request - invalid or missing authorization header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid authorization header'
      });
    }
  } else {
    // No secret configured - log warning but allow (for easier local testing)
    logger.warn('CRON_SECRET not configured - anyone can trigger this endpoint!');
  }

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

      logger.info('=== Cron sync job completed successfully ===');

      return res.status(200).json({
        success: true,
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
    logger.error('Cron sync job failed:', error);

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

/**
 * Alternative: Send messages in batches
 *
 * If Poke supports batch delivery, this can be more efficient.
 * Uncomment and modify if Poke has a batch endpoint.
 */
/*
async function sendMessagesToPokeBatch(channelResults) {
  const pokeClient = new PokeClient();

  // Collect all messages into a single batch
  const allMessages = [];
  for (const channelData of Object.values(channelResults)) {
    if (channelData.success && channelData.messages) {
      allMessages.push(...channelData.messages);
    }
  }

  if (allMessages.length === 0) {
    return { successCount: 0, failureCount: 0, errors: [] };
  }

  // Send batch
  try {
    const batchPayload = {
      source: 'slack',
      messageCount: allMessages.length,
      messages: allMessages,
      metadata: {
        batchedAt: new Date().toISOString(),
        integrationVersion: '1.0.0'
      }
    };

    await pokeClient.sendThread(batchPayload);

    return {
      successCount: allMessages.length,
      failureCount: 0,
      errors: []
    };

  } catch (error) {
    logger.error('Batch send to Poke failed:', error);

    return {
      successCount: 0,
      failureCount: allMessages.length,
      errors: [{ error: error.message }]
    };
  }
}
*/
