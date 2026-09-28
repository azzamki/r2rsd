#!/usr/bin/env node
/**
 * AI Visitor Bot - Main Entry Point
 */
const logger = require('./src/utils/logger');
const { startServer } = require('./src/server');
const proxyManager = require('./src/proxy/proxyManager');
const config = require('./src/config');

async function main() {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║       🤖  AI VISITOR BOT  v1.0.0              ║');
  console.log('║   Multi-Agent | Proxy | Human-Like Behavior   ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('\n');

  // Start web server
  startServer();

  // Auto-init proxies if configured
  if (config.proxy.autoGrab) {
    logger.info('🔄 Auto-initializing proxy pool...');
    proxyManager.initialize().then(working => {
      logger.info(`✅ Proxy pool ready: ${working.length} working proxies`);
      // Keep the pool fresh forever: grab + check on a timer so dead free
      // proxies are continuously replaced with new working ones.
      // immediate:false — initialize() just did a full grab+check.
      if (config.proxy.refreshInterval !== 0) {
        proxyManager.startAutoRefresh(undefined, { immediate: false });
      }
    }).catch(e => {
      logger.warn(`⚠️ Proxy init warning: ${e.message}`);
    });
  }
}

process.on('unhandledRejection', (reason) => {
  logger.warn(`⚠️ Unhandled Rejection: ${reason?.message || reason}`);
});

process.on('uncaughtException', (err) => {
  logger.error(`⚠️ Uncaught Exception: ${err?.message || err}`);
});

main().catch(e => {
  logger.error('Fatal error:', e);
  process.exit(1);
});
