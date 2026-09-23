const fs = require('fs');

// Host-provided runtime secrets and paths live outside releases so a fresh
// checkout never needs credentials in git. Deploys source the same file the
// SSH command exports; the ecosystem merges it so `pm2 startOrReload` also
// works from a bare shell (a bare env would boot without POORUP_DATA_DIR and
// fail assertProductionCors, crashing the release loop).
const SHARED_ENV_FILE = (typeof process !== 'undefined' && process.env.POORUP_SHARED_ENV_FILE) || '/srv/poorup/shared/poorup.env';

function loadSharedEnv(filePath) {
  try {
    const out = {};
    for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1);
    }
    return out;
  } catch {
    return {};
  }
}

module.exports = {
  apps: [{
    name: 'poorup',
    script: '/srv/poorup/current/server/server.js',
    cwd: '/srv/poorup/current',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    autorestart: true,
    restart_delay: 2000,
    max_memory_restart: '512M',
    // Must exceed the server's drain deadline (default 30s): SIGKILL
    // arriving first would abort in-flight writes mid-drain.
    kill_timeout: 45000,
    listen_timeout: 10000,
    shutdown_with_message: true,
    env: {
      NODE_ENV: 'production',
      ...loadSharedEnv(SHARED_ENV_FILE)
    }
  }]
};

