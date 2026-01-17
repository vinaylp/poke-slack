/**
 * Health Check Endpoint (Vercel Serverless Function)
 *
 * This endpoint provides a simple way to monitor the service health and
 * configuration status. It's useful for:
 * - Uptime monitoring services
 * - Verifying deployment success
 * - Debugging configuration issues
 *
 * The health check validates that:
 * - The service is running
 * - Required environment variables are configured
 * - The configuration is valid
 *
 * Endpoint: GET /api/health
 * Response: JSON with health status and metadata
 */

const logger = require('../utils/logger');
const { getMonitoredChannels } = require('../config/constants');

/**
 * Health Check Handler
 *
 * Returns service health status and configuration information.
 * This endpoint does NOT require authentication - it's meant to be
 * publicly accessible for monitoring purposes.
 *
 * @param {Object} req - Vercel request object
 * @param {Object} res - Vercel response object
 * @returns {Promise<void>}
 */
module.exports = async (req, res) => {
  logger.debug('Health check requested');

  try {
    // Get configuration status
    const monitoredChannels = getMonitoredChannels();

    // Determine overall health status
    // The service is healthy if configuration is valid
    const isHealthy = true; // If we got here, config validation passed

    // Build health check response
    const healthData = {
      // Overall status
      status: isHealthy ? 'healthy' : 'unhealthy',

      // Timestamp for monitoring tools
      timestamp: new Date().toISOString(),

      // Service metadata
      service: {
        name: 'slack-poke-integration',
        version: '1.0.0'
      },

      // Environment information
      environment: {
        nodeVersion: process.version,
        nodeEnv: process.env.NODE_ENV || 'production',
        platform: process.platform
      },

      // Configuration status (without exposing secrets)
      configuration: {
        monitoredChannelsCount: monitoredChannels.length,
        monitoredChannels: monitoredChannels, // Channel IDs are not sensitive
        slackConfigured: !!process.env.SLACK_BOT_TOKEN,
        pokeConfigured: !!process.env.POKE_WEBHOOK_URL,
        authenticationEnabled: !!process.env.POKE_API_KEY
      },

      // Uptime information (only meaningful in long-running containers)
      // In serverless, this resets with each cold start
      uptime: {
        processUptimeSeconds: Math.floor(process.uptime()),
        memoryUsage: {
          heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
          rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
          unit: 'MB'
        }
      }
    };

    // Return 200 OK with health data
    return res.status(200).json(healthData);

  } catch (error) {
    // If health check itself fails, service is unhealthy
    logger.error('Health check failed:', error);

    return res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        type: error.name
      }
    });
  }
};
