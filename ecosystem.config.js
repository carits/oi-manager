module.exports = {
  apps: [
    {
      name: 'oi-server',
      script: 'dist/index.js',
      cwd: './apps/server',
      instances: 'max',        // 根据 CPU 核数自动
      exec_mode: 'cluster',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
    },
  ],
}
