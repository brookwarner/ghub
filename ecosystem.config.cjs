module.exports = {
  apps: [{
    name: 'multi-gmail',
    script: 'dist/index.js',
    cwd: '/var/www/mcp.brookwarner.com',
    env: {
      NODE_ENV: 'production',
      PORT: '8080',
      GMAILMCPCONFIG_DIR: '/var/data/multi-gmail',
      SECRET_TOKEN: process.env.SECRET_TOKEN || '',
    },
  }],
};
