// /project/workspace/logger.js
const pino = require('pino');

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty'
  }
});

module.exports = logger;