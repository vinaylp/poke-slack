/**
 * Poke Webhook Client
 *
 * This module handles sending formatted Slack conversation threads to the
 * Poke webhook endpoint. It implements robust error handling, retry logic,
 * and proper authentication.
 *
 * The client uses exponential backoff for retries to handle transient network
 * issues and rate limiting gracefully.
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const logger = require('../utils/logger');

/**
 * Poke Webhook Client
 *
 * Sends formatted conversation thread data to Poke's webhook endpoint.
 * Features:
 * - Automatic retry with exponential backoff
 * - Configurable timeout
 * - Optional authentication via API key
 * - Detailed error logging
 */
class PokeClient {
  /**
   * Initialize the Poke webhook client
   *
   * Configuration is read from environment variables:
   * - POKE_WEBHOOK_URL (required): The Poke endpoint URL
   * - POKE_API_KEY (optional): Bearer token for authentication
   *
   * @throws {Error} If POKE_WEBHOOK_URL is not set
   */
  constructor() {
    this.webhookUrl = process.env.POKE_WEBHOOK_URL;
    this.apiKey = process.env.POKE_API_KEY;

    if (!this.webhookUrl) {
      throw new Error('POKE_WEBHOOK_URL environment variable is required');
    }

    // Default timeout for HTTP requests (30 seconds)
    this.timeout = 30000;

    // Default retry configuration
    this.maxRetries = 3;
  }

  /**
   * Send a formatted thread payload to Poke
   *
   * This is the main public method. It implements retry logic with
   * exponential backoff to handle transient failures.
   *
   * Retry strategy:
   * - Attempt 1: Immediate
   * - Attempt 2: After 2 seconds (2^1 * 1000ms)
   * - Attempt 3: After 4 seconds (2^2 * 1000ms)
   *
   * @param {Object} payload - The formatted thread data to send
   * @param {number} [retries=3] - Maximum number of retry attempts
   * @returns {Promise<Object>} Response from Poke endpoint
   * @throws {Error} If all retry attempts fail
   *
   * @example
   * const pokeClient = new PokeClient();
   * try {
   *   const response = await pokeClient.sendThread(threadPayload);
   *   console.log('Successfully sent to Poke:', response);
   * } catch (error) {
   *   console.error('Failed to send to Poke after retries:', error);
   * }
   */
  async sendThread(payload, retries = this.maxRetries) {
    // Validate payload before sending
    if (!payload || typeof payload !== 'object') {
      throw new Error('Payload must be a valid object');
    }

    // Attempt to send with retry logic
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        logger.info(`Sending thread to Poke (attempt ${attempt}/${retries})`);

        // Make the HTTP request
        const response = await this._sendRequest(payload);

        logger.info('Successfully sent thread to Poke');
        return response;

      } catch (error) {
        logger.error(`Attempt ${attempt} failed:`, error.message);

        // If this was the last attempt, throw the error
        if (attempt === retries) {
          throw new Error(`Failed to send to Poke after ${retries} attempts: ${error.message}`);
        }

        // Calculate exponential backoff delay
        // 2^attempt * 1000ms (e.g., 2s, 4s, 8s)
        const delay = Math.pow(2, attempt) * 1000;

        logger.info(`Retrying in ${delay}ms...`);

        // Wait before retrying
        await this._sleep(delay);
      }
    }
  }

  /**
   * Internal method to send the actual HTTP request
   *
   * Uses Node.js built-in http/https modules for zero dependencies.
   * Constructs proper headers including authentication if configured.
   *
   * @private
   * @param {Object} payload - The data to send
   * @returns {Promise<Object>} Parsed JSON response
   * @throws {Error} If the request fails or returns non-2xx status
   */
  async _sendRequest(payload) {
    return new Promise((resolve, reject) => {
      // Parse the webhook URL
      const url = new URL(this.webhookUrl);
      const isHttps = url.protocol === 'https:';

      // Prepare the request payload
      const payloadString = JSON.stringify(payload);

      // Construct HTTP headers
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payloadString),
        'User-Agent': 'slack-poke-integration/1.0'
      };

      // Add authentication header if API key is configured
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      // Configure the HTTP request
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname + url.search,
        method: 'POST',
        headers: headers,
        timeout: this.timeout
      };

      // Select http or https module based on URL protocol
      const client = isHttps ? https : http;

      // Make the request
      const req = client.request(options, (res) => {
        let responseData = '';

        // Collect response data chunks
        res.on('data', (chunk) => {
          responseData += chunk;
        });

        // Handle response completion
        res.on('end', () => {
          // Check for successful status codes (2xx)
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              // Try to parse JSON response
              const parsedResponse = responseData ? JSON.parse(responseData) : {};
              resolve(parsedResponse);
            } catch (parseError) {
              // If response is not JSON, return raw text
              resolve({ success: true, data: responseData });
            }
          } else {
            // Non-2xx status code indicates failure
            reject(new Error(
              `Poke webhook returned status ${res.statusCode}: ${responseData}`
            ));
          }
        });
      });

      // Handle request errors (network issues, DNS failures, etc.)
      req.on('error', (error) => {
        reject(new Error(`HTTP request failed: ${error.message}`));
      });

      // Handle request timeout
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Request timeout after ${this.timeout}ms`));
      });

      // Send the payload
      req.write(payloadString);
      req.end();
    });
  }

  /**
   * Sleep utility for implementing retry delays
   *
   * @private
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>} Resolves after the specified delay
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test the Poke webhook connection
   *
   * Sends a minimal test payload to verify that the webhook is accessible
   * and properly configured. Useful for debugging and health checks.
   *
   * @returns {Promise<boolean>} True if connection test succeeds
   *
   * @example
   * const pokeClient = new PokeClient();
   * const isConnected = await pokeClient.testConnection();
   * if (isConnected) {
   *   console.log('Poke webhook is accessible');
   * }
   */
  async testConnection() {
    try {
      const testPayload = {
        test: true,
        timestamp: new Date().toISOString(),
        message: 'Connection test from slack-poke-integration'
      };

      await this.sendThread(testPayload, 1); // Single attempt for tests
      return true;
    } catch (error) {
      logger.error('Connection test failed:', error);
      return false;
    }
  }
}

module.exports = PokeClient;
