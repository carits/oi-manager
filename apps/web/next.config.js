/** @type {import('next').NextConfig} */
const nextConfig = {
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
}

module.exports = nextConfig
