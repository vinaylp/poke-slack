/**
 * State Manager for Tracking Last Processed Timestamp
 *
 * This module manages persistent state to track which messages have already
 * been processed and sent to Poke. It stores the last processed timestamp
 * for each monitored channel.
 *
 * IMPLEMENTATION NOTE:
 * This uses a simple file-based approach suitable for single-instance deployments.
 * For production with multiple Vercel instances, consider using:
 * - Vercel KV (Redis): @vercel/kv package
 * - Vercel Postgres: @vercel/postgres package
 * - External Redis/database
 *
 * The file is stored in /tmp which is:
 * - Writable in Vercel serverless functions
 * - Ephemeral (cleared on cold starts)
 * - Per-instance (not shared across function instances)
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

// State file location (writable in Vercel)
const STATE_FILE = '/tmp/slack-poke-state.json';

// Default lookback period if no state exists (in minutes)
// Set to 24 hours for daily cron jobs
const DEFAULT_LOOKBACK_MINUTES = 1440; // 24 hours

// Maximum age before falling back to default lookback (in hours)
// If last processed timestamp is older than this, use DEFAULT_LOOKBACK instead
const MAX_TIMESTAMP_AGE_HOURS = 48;

/**
 * State Manager Class
 *
 * Manages persistent state for tracking processed messages across channels.
 * State structure: { channelId: lastProcessedTimestamp, ... }
 */
class StateManager {
  constructor() {
    this.state = null;
    this.loaded = false;
  }

  /**
   * Load state from file
   *
   * If the file doesn't exist (cold start), initializes with empty state.
   * If the file is corrupted, logs error and resets to empty state.
   *
   * @returns {Promise<Object>} Current state object
   */
  async load() {
    if (this.loaded && this.state !== null) {
      logger.debug('Using cached state');
      return this.state;
    }

    try {
      // Check if state file exists
      await fs.access(STATE_FILE);

      // Read and parse state file
      const data = await fs.readFile(STATE_FILE, 'utf8');
      this.state = JSON.parse(data);

      logger.info('State loaded from file', { channels: Object.keys(this.state).length });
      this.loaded = true;

      return this.state;

    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - this is normal on cold start
        logger.info('No existing state file, initializing new state');
      } else {
        // File exists but is corrupted
        logger.error('Error loading state file, resetting:', error);
      }

      // Initialize with empty state
      this.state = {};
      this.loaded = true;

      return this.state;
    }
  }

  /**
   * Save state to file
   *
   * Persists the current state to disk so it survives across function invocations
   * (within the same instance lifetime).
   *
   * @returns {Promise<void>}
   */
  async save() {
    try {
      const data = JSON.stringify(this.state, null, 2);
      await fs.writeFile(STATE_FILE, data, 'utf8');

      logger.debug('State saved to file');

    } catch (error) {
      logger.error('Error saving state file:', error);
      throw error;
    }
  }

  /**
   * Get the last processed timestamp for a channel
   *
   * If no timestamp exists for the channel, returns a timestamp from
   * DEFAULT_LOOKBACK_MINUTES ago to avoid processing too much history.
   *
   * FALLBACK LOGIC: If the stored timestamp is older than MAX_TIMESTAMP_AGE_HOURS,
   * it's considered stale (e.g., from a cold start or long downtime) and we fall
   * back to DEFAULT_LOOKBACK to avoid processing too much history.
   *
   * @param {string} channelId - The Slack channel ID
   * @returns {Promise<string>} Slack timestamp (e.g., "1234567890.123456")
   */
  async getLastProcessedTimestamp(channelId) {
    await this.load();

    if (this.state[channelId]) {
      const storedTimestamp = parseFloat(this.state[channelId]);
      const storedTime = storedTimestamp * 1000; // Convert to milliseconds
      const ageHours = (Date.now() - storedTime) / (1000 * 60 * 60);

      // Check if timestamp is too old (stale)
      if (ageHours > MAX_TIMESTAMP_AGE_HOURS) {
        logger.warn(
          `Stored timestamp for ${channelId} is ${ageHours.toFixed(1)}hrs old (max ${MAX_TIMESTAMP_AGE_HOURS}hrs), using fallback lookback`
        );

        // Fall back to default lookback period
        const lookbackMs = DEFAULT_LOOKBACK_MINUTES * 60 * 1000;
        const lookbackTime = Date.now() - lookbackMs;
        const slackTimestamp = (lookbackTime / 1000).toFixed(6);

        logger.info(`Using ${DEFAULT_LOOKBACK_MINUTES}min lookback: ${slackTimestamp}`);
        return slackTimestamp;
      }

      logger.debug(`Last processed timestamp for ${channelId}: ${this.state[channelId]} (${ageHours.toFixed(1)}hrs old)`);
      return this.state[channelId];
    }

    // No previous timestamp - calculate lookback timestamp
    const lookbackMs = DEFAULT_LOOKBACK_MINUTES * 60 * 1000;
    const lookbackTime = Date.now() - lookbackMs;
    const slackTimestamp = (lookbackTime / 1000).toFixed(6);

    logger.info(
      `No previous timestamp for ${channelId}, using ${DEFAULT_LOOKBACK_MINUTES}min lookback: ${slackTimestamp}`
    );

    return slackTimestamp;
  }

  /**
   * Update the last processed timestamp for a channel
   *
   * This should be called after successfully processing and sending
   * messages to Poke.
   *
   * Slack timestamps are in format "1234567890.123456" (seconds.microseconds)
   * and are guaranteed to be monotonically increasing.
   *
   * @param {string} channelId - The Slack channel ID
   * @param {string} timestamp - The Slack timestamp to save
   * @returns {Promise<void>}
   */
  async setLastProcessedTimestamp(channelId, timestamp) {
    await this.load();

    // Only update if the new timestamp is newer
    const currentTimestamp = this.state[channelId];
    if (!currentTimestamp || parseFloat(timestamp) > parseFloat(currentTimestamp)) {
      this.state[channelId] = timestamp;

      logger.info(`Updated last processed timestamp for ${channelId}: ${timestamp}`);

      await this.save();
    } else {
      logger.debug(`Timestamp ${timestamp} is not newer than current ${currentTimestamp}, skipping update`);
    }
  }

  /**
   * Update timestamps for multiple channels at once
   *
   * Useful for batch updates after processing multiple channels.
   *
   * @param {Object} updates - Map of channelId -> timestamp
   * @returns {Promise<void>}
   *
   * @example
   * await stateManager.batchUpdate({
   *   'C123': '1234567890.123456',
   *   'C456': '1234567891.234567'
   * });
   */
  async batchUpdate(updates) {
    await this.load();

    let updateCount = 0;

    for (const [channelId, timestamp] of Object.entries(updates)) {
      const currentTimestamp = this.state[channelId];

      if (!currentTimestamp || parseFloat(timestamp) > parseFloat(currentTimestamp)) {
        this.state[channelId] = timestamp;
        updateCount++;
      }
    }

    if (updateCount > 0) {
      logger.info(`Batch updated ${updateCount} channel timestamps`);
      await this.save();
    } else {
      logger.debug('No timestamps needed updating in batch');
    }
  }

  /**
   * Reset state for a specific channel
   *
   * Useful for reprocessing messages from a channel or debugging.
   *
   * @param {string} channelId - The channel to reset
   * @returns {Promise<void>}
   */
  async resetChannel(channelId) {
    await this.load();

    if (this.state[channelId]) {
      delete this.state[channelId];
      await this.save();

      logger.info(`Reset state for channel ${channelId}`);
    }
  }

  /**
   * Reset all state
   *
   * Clears all tracked timestamps. Next sync will process messages from
   * DEFAULT_LOOKBACK_MINUTES ago for all channels.
   *
   * @returns {Promise<void>}
   */
  async resetAll() {
    this.state = {};
    this.loaded = true;
    await this.save();

    logger.warn('Reset all state - next sync will reprocess recent messages');
  }

  /**
   * Get current state for debugging
   *
   * @returns {Promise<Object>} Current state object
   */
  async getState() {
    await this.load();
    return { ...this.state };
  }

  /**
   * Get statistics about tracked channels
   *
   * @returns {Promise<Object>} Statistics object
   */
  async getStats() {
    await this.load();

    const channels = Object.keys(this.state);
    const timestamps = Object.values(this.state).map(ts => parseFloat(ts));

    return {
      trackedChannels: channels.length,
      channels: channels,
      oldestTimestamp: timestamps.length > 0 ? Math.min(...timestamps) : null,
      newestTimestamp: timestamps.length > 0 ? Math.max(...timestamps) : null
    };
  }
}

// Export singleton instance
module.exports = new StateManager();
