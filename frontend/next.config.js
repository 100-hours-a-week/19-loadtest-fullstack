/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export', // 정적 HTML 생성의 핵심
  reactStrictMode: false,
  transpilePackages: ['@vapor-ui/core', '@vapor-ui/icons'],
  devIndicators: {
    buildActivity: true,
    buildActivityPosition: 'bottom-right'
  },
  images: {
    unoptimized: true, // next/image 사용 시 필수
  },
  ...(process.env.NODE_ENV === 'development' && {
    experimental: {
      forceSwcTransforms: true
    }
  })
};

module.exports = nextConfig;
