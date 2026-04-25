/** @type {import('next').NextConfig} */
const nextConfig = {
  // 只在生产构建时使用 standalone 输出，dev 模式下会导致 vendor chunk 500 错误
  ...(process.env.NODE_ENV === 'production' && { output: 'standalone' }),
  compress: true,
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
}

module.exports = nextConfig
