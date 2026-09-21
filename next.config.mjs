/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  basePath: '/color-your-photo',
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
