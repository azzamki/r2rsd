/**
 * Logger utility using Winston
 */
const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Create logs dir
const logDir = path.resolve(config.logging.logDir);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
});

const logger = winston.createLogger({
  level: config.logging.level || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'HH:mm:ss' }),
        logFormat
      ),
    }),
    ...(config.logging.saveToFile
      ? [
          new winston.transports.File({
            filename: path.join(logDir, 'error.log'),
            level: 'error',
          }),
          new winston.transports.File({
            filename: path.join(logDir, 'combined.log'),
          }),
        ]
      : []),
  ],
});

module.exports = logger;
