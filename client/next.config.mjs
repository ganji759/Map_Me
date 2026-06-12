/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      {
        source: '/adk/:path*',
        destination: `${process.env.ADK_BASE_URL || 'http://localhost:8000'}/:path*`,
      },
    ]
  },
}

export default nextConfig
