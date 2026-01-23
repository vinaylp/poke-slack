/**
 * Configuration and Constants
 *
 * This module validates environment configuration on startup and exports
 * configuration values used throughout the application.
 *
 * It implements a "fail fast" approach: if required configuration is missing,
 * the application should fail to start rather than fail at runtime.
 */

const logger = require('../utils/logger');

/**
 * Required environment variables
 *
 * These MUST be set for the application to function.
 * The application will throw an error on startup if any are missing.
 */
const REQUIRED_ENV_VARS = [
  'SLACK_BOT_TOKEN',
  'SLACK_MONITOR_CHANNELS',
  'MCP_AUTH_TOKEN'  // Required for API authentication
];

/**
 * Optional environment variables with their default values
 *
 * These can be customized but have sensible defaults.
 */
const OPTIONAL_ENV_VARS = {
  LOG_LEVEL: 'info',
  NODE_ENV: 'production',
  INCLUDE_USER_EMAILS: 'false',  // Set to 'true' to include emails in responses
  RATE_LIMIT_MAX: '60',          // Max requests per window
  RATE_LIMIT_WINDOW_MS: '60000'  // Rate limit window in ms (default: 1 minute)
};

/**
 * Validate that all required environment variables are set
 *
 * This function should be called once on application startup.
 * It checks for required variables and logs warnings for missing optional ones.
 *
 * @throws {Error} If any required environment variables are missing
 */
function validateConfig() {
  logger.info('Validating configuration...');

  const missing = [];

  // Check for required variables
  for (const varName of REQUIRED_ENV_VARS) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  // If any required variables are missing, fail with a helpful error message
  if (missing.length > 0) {
    const errorMessage = `Missing required environment variables: ${missing.join(', ')}`;
    logger.error(errorMessage);
    throw new Error(errorMessage);
  }

  // Validate SLACK_MONITOR_CHANNELS format
  // Should be comma-separated channel IDs (e.g., "C123,C456")
  const channels = process.env.SLACK_MONITOR_CHANNELS;
  if (channels) {
    const channelList = channels.split(',').map(c => c.trim());
    const invalidChannels = channelList.filter(c => !c.startsWith('C') && !c.startsWith('G'));

    if (invalidChannels.length > 0) {
      logger.warn(
        'Some channel IDs may be invalid:',
        invalidChannels,
        '(Expected format: C123456789 for public channels, G123456789 for private)'
      );
    }

    logger.info(`Monitoring ${channelList.length} channel(s): ${channelList.join(', ')}`);
  }

  // MCP-based integration - no webhook URL needed

  logger.info('Configuration validation complete');
}

/**
 * Get a configuration value with optional default
 *
 * @param {string} key - The environment variable name
 * @param {any} defaultValue - Default value if not set
 * @returns {any} The configuration value
 */
function getConfig(key, defaultValue = null) {
  return process.env[key] || defaultValue;
}

/**
 * Get the list of monitored channel IDs
 *
 * @returns {Array<string>} Array of channel IDs to monitor
 */
function getMonitoredChannels() {
  const channels = getConfig('SLACK_MONITOR_CHANNELS', '');
  return channels.split(',').map(c => c.trim()).filter(c => c.length > 0);
}

/**
 * Check if we're running in development mode
 *
 * @returns {boolean} True if NODE_ENV is 'development'
 */
function isDevelopment() {
  return getConfig('NODE_ENV', 'production') === 'development';
}

/**
 * Check if we're running in production mode
 *
 * @returns {boolean} True if NODE_ENV is 'production'
 */
function isProduction() {
  return getConfig('NODE_ENV', 'production') === 'production';
}

/**
 * Check if user emails should be included in responses
 *
 * @returns {boolean} True if INCLUDE_USER_EMAILS is 'true'
 */
function includeUserEmails() {
  return getConfig('INCLUDE_USER_EMAILS', 'false') === 'true';
}

/**
 * Get the MCP authentication token
 *
 * @returns {string} The MCP auth token
 */
function getMcpAuthToken() {
  return getConfig('MCP_AUTH_TOKEN', '');
}

/**
 * Get rate limit configuration
 *
 * @returns {Object} Rate limit settings
 */
function getRateLimitConfig() {
  return {
    maxRequests: parseInt(getConfig('RATE_LIMIT_MAX', '60'), 10),
    windowMs: parseInt(getConfig('RATE_LIMIT_WINDOW_MS', '60000'), 10)
  };
}

// Validate configuration on module load
// This ensures that configuration errors are caught immediately on startup
// rather than during request processing
try {
  validateConfig();
} catch (error) {
  // In serverless environments, we want to fail fast
  // Log the error and re-throw so the function won't deploy/start
  logger.error('Configuration validation failed:', error);
  throw error;
}

// Export configuration utilities
module.exports = {
  validateConfig,
  getConfig,
  getMonitoredChannels,
  isDevelopment,
  isProduction,
  includeUserEmails,
  getMcpAuthToken,
  getRateLimitConfig,
  REQUIRED_ENV_VARS,
  OPTIONAL_ENV_VARS
};
