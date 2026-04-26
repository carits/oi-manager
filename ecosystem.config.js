module.exports = {
  apps: [
    {
      name: 'oi-server',
      script: 'dist/index.js',
      cwd: './apps/server',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
    },
    {
      name: 'oi-web',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: './apps/web',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'oi-judge',
      script: 'dist/index.js',
      cwd: './apps/judge',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        BACKEND_URL: 'ws://localhost:3002',
        TESTDATA_DIR: '/app/apps/server/testdata',
      },
    },
  ],
}
