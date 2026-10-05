// PM2 process file. Two instances so reloads have no downtime. Runs beside scoothero-backoffice.
module.exports = {
  apps: [{
    name: 'feest-backoffice',
    script: 'server.js',
    cwd: '/var/www/feest-backoffice/current',
    instances: 2,
    exec_mode: 'cluster',
    env_file: '/var/www/feest-backoffice/shared/.env',
    max_memory_restart: '400M',
    time: true,
  }],
};
