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
}

module.exports = nextConfig
