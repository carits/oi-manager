module.exports = {
  apps: [
    {
      name: 'oi-web-preview',
      script: 'pnpm',
      args: '--filter web preview:start',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        APP_ENV: 'development',
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
  ],
}
