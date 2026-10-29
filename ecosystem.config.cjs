// Host-provided runtime secrets and paths live outside releases so a fresh
// checkout never needs credentials in git. Deploys source the same file the
// SSH command exports; the ecosystem merges it so `pm2 startOrReload` also
// works from a bare shell (a bare env would boot without POORUP_DATA_DIR and
// fail assertProductionCors, crashing the release loop). The shared parser
// reads the file exactly as the bash deploy scripts do, and it throws on a
// line bash would read differently, so a bad env file stops the reload.
const { loadEnvFile } = require('./scripts/loadEnvFile.cjs');

const SHARED_ENV_FILE = (typeof process !== 'undefined' && process.env.POORUP_SHARED_ENV_FILE) || '/srv/poorup/shared/poorup.env';

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
      ...loadEnvFile(SHARED_ENV_FILE)
    }
  }]
};

