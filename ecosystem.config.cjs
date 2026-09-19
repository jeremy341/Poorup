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
      NODE_ENV: 'production'
    }
  }]
};

