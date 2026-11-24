'use strict';

const { start, createApp } = require('./index');
const appModule = require('./app');

if (require.main === module) {
  start().catch(error => {
    console.error('Relayer startup failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  start,
  createApp,
  ...appModule,
};
