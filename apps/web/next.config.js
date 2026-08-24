const { PHASE_DEVELOPMENT_SERVER } = require('next/constants')

/**
 * @param {string} phase
 * @returns {import('next').NextConfig}
 */
function createNextConfig(phase) {
  const appEnv = process.env.APP_ENV || 'development'
  return {
    env: {
      NEXT_PUBLIC_APP_ENV: appEnv,
    },
    // Never let a build overwrite the cache used by a running development server.
    distDir:
      process.env.NEXT_DIST_DIR ||
      (phase === PHASE_DEVELOPMENT_SERVER ? '.next-dev' : '.next'),
    compress: true,
    poweredByHeader: false,
    reactStrictMode: false,
    transpilePackages: ['shared', '@oi-manager/shared'],
    webpack: (config) => {
      config.resolve.alias = {
        ...config.resolve.alias,
        '@oi-manager/shared': require('path').resolve(__dirname, '../../packages/shared/src'),
      }
      return config
    },
    async rewrites() {
      const backendUrl = process.env.BACKEND_URL || 'http://localhost:3002'
      return [
        {
          source: '/api/:path*',
          destination: `${backendUrl}/api/:path*`,
        },
      ]
    },
    async headers() {
      return [
        {
          source: '/:path*',
          headers: [
            { key: 'X-Content-Type-Options', value: 'nosniff' },
            { key: 'X-Frame-Options', value: 'DENY' },
            { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
            { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          ],
        },
      ]
    },
  }
}

module.exports = createNextConfig
