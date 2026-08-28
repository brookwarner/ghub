const fs = require('fs');

// Never hardcode SECRET_TOKEN here: this file is committed.
//
// It is read from an untracked .env inside the config dir (outside the repo, so
// the deploy's `git reset --hard` cannot clobber it). Reading from a file rather
// than relying solely on the deploy step's inline env means the token is present
// however PM2 is invoked: the deploy workflow, a manual `pm2 restart`, or
// resurrect after a reboot.
//
// This previously resolved to '' when the variable was absent, which made the
// server disable its own auth middleware and serve every configured Google
// account unauthenticated. It now refuses to start instead.
const ENV_FILE = process.env.GHUB_ENV_FILE || '/var/data/multi-gmail/.env';

function readEnvFile(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .reduce((acc, line) => {
        const eq = line.indexOf('=');
        if (eq === -1) return acc;
        acc[line.slice(0, eq).trim()] = line
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
        return acc;
      }, {});
  } catch {
    return {};
  }
}

const SECRET_TOKEN = process.env.SECRET_TOKEN || readEnvFile(ENV_FILE).SECRET_TOKEN;

if (!SECRET_TOKEN) {
  throw new Error(
    `SECRET_TOKEN not found. Set it in ${ENV_FILE} or pass it in the environment. ` +
      'Refusing to start the server unprotected.',
  );
}

module.exports = {
  apps: [{
    name: 'multi-gmail',
    script: 'dist/index.js',
    cwd: '/var/www/mcp.brookwarner.com',
    env: {
      NODE_ENV: 'production',
      // Loopback only: this host reaches the app solely through the LiteSpeed
      // reverse proxy, which targets http://127.0.0.1:8080. The code defaults to
      // 0.0.0.0 so container deployments still bind where they need to; only
      // this VPS config narrows it.
      HOST: '127.0.0.1',
      PORT: '8080',
      GMAILMCPCONFIG_DIR: '/var/data/multi-gmail',
      SECRET_TOKEN,
    },
  }],
};
