module.exports = {
  apps: [{
    name: 'hanbot',
    script: 'index.js',
    env: {
      PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: 'true',
      GOOGLE_CHROME_BIN: '/usr/bin/chromium-browser',
      PORT: '3000'
    },
    max_memory_restart: '500M',
    watch: false,
    autorestart: true
  }]
};
