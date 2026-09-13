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
    kill_timeout: 15000,
    listen_timeout: 10000,
    shutdown_with_message: true,
    env: {
      NODE_ENV: 'production'
    }
  }]
};

