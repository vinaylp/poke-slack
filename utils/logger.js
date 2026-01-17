/**
 * Logging Utility
 *
 * Provides structured logging for the application with different severity levels.
 * In production (Vercel), logs are sent to stdout and automatically collected
 * by Vercel's logging infrastructure.
 *
 * Log levels (in order of severity):
 * - debug: Detailed diagnostic information
 * - info: General informational messages
 * - warn: Warning messages for potentially harmful situations
 * - error: Error messages for serious problems
 *
 * The LOG_LEVEL environment variable controls which messages are output.
 */

/**
 * Available log levels with their severity rankings
 */
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

/**
 * Get the current log level from environment or default to 'info'
 *
 * In production, you typically want 'info' or 'warn' to reduce noise.
 * In development, 'debug' can be helpful for troubleshooting.
 *
 * @returns {string} The current log level
 */
function getCurrentLogLevel() {
  const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LOG_LEVELS.hasOwnProperty(envLevel) ? envLevel : 'info';
}

/**
 * Determine if a message at the given level should be logged
 *
 * @param {string} level - The level of the message to log
 * @returns {boolean} True if the message should be logged
 */
function shouldLog(level) {
  const currentLevel = getCurrentLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

/**
 * Format a log message with timestamp and level
 *
 * Output format: [TIMESTAMP] [LEVEL] message ...args
 *
 * @param {string} level - The log level (debug, info, warn, error)
 * @param {string} message - The main log message
 * @param {...any} args - Additional arguments to log
 * @returns {Object} Structured log object
 */
function formatLogMessage(level, message, ...args) {
  return {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    message: message,
    // Include any additional arguments as metadata
    ...(args.length > 0 && { metadata: args })
  };
}

/**
 * Output a log message to the console
 *
 * Uses appropriate console method based on severity:
 * - error -> console.error
 * - warn -> console.warn
 * - info, debug -> console.log
 *
 * @param {string} level - The log level
 * @param {Object} formattedMessage - The formatted log object
 */
function outputLog(level, formattedMessage) {
  const logString = JSON.stringify(formattedMessage);

  switch (level) {
    case 'error':
      console.error(logString);
      break;
    case 'warn':
      console.warn(logString);
      break;
    default:
      console.log(logString);
  }
}

/**
 * Logger object with methods for each log level
 */
const logger = {
  /**
   * Log a debug message
   *
   * Use for detailed diagnostic information that's helpful during development
   * but too verbose for production.
   *
   * @param {string} message - The message to log
   * @param {...any} args - Additional data to include
   *
   * @example
   * logger.debug('Cache hit for user', userId, cacheStats);
   */
  debug(message, ...args) {
    if (shouldLog('debug')) {
      const formatted = formatLogMessage('debug', message, ...args);
      outputLog('debug', formatted);
    }
  },

  /**
   * Log an info message
   *
   * Use for general informational messages about normal operation.
   * These are the primary logs you'll see in production.
   *
   * @param {string} message - The message to log
   * @param {...any} args - Additional data to include
   *
   * @example
   * logger.info('Processing thread', channelId, threadTs);
   */
  info(message, ...args) {
    if (shouldLog('info')) {
      const formatted = formatLogMessage('info', message, ...args);
      outputLog('info', formatted);
    }
  },

  /**
   * Log a warning message
   *
   * Use for potentially harmful situations that don't prevent operation
   * but should be investigated.
   *
   * @param {string} message - The message to log
   * @param {...any} args - Additional data to include
   *
   * @example
   * logger.warn('User not found, using placeholder', userId);
   */
  warn(message, ...args) {
    if (shouldLog('warn')) {
      const formatted = formatLogMessage('warn', message, ...args);
      outputLog('warn', formatted);
    }
  },

  /**
   * Log an error message
   *
   * Use for errors and exceptions that indicate a problem requiring attention.
   * Always include the error object if available.
   *
   * @param {string} message - The message to log
   * @param {...any} args - Additional data to include (often an Error object)
   *
   * @example
   * logger.error('Failed to fetch thread', error);
   * logger.error('Webhook request failed', { statusCode: 500, response });
   */
  error(message, ...args) {
    if (shouldLog('error')) {
      // Special handling for Error objects to include stack traces
      const processedArgs = args.map(arg => {
        if (arg instanceof Error) {
          return {
            message: arg.message,
            stack: arg.stack,
            name: arg.name
          };
        }
        return arg;
      });

      const formatted = formatLogMessage('error', message, ...processedArgs);
      outputLog('error', formatted);
    }
  }
};

module.exports = logger;
