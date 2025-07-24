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
  }),

  // Webpack 설정으로 에러 오버레이 완전 비활성화
  webpack: (config, { dev, isServer }) => {
    if (dev && !isServer) {
      // 에러 오버레이 모듈을 빈 모듈로 대체
      config.resolve.alias = {
        ...config.resolve.alias,
        '@next/react-dev-overlay/lib/client': false,
        'next/dist/client/components/react-dev-overlay/hot-reloader-client': false,
      };

      // webpack-hot-middleware 설정
      const originalEntry = config.entry;
      config.entry = async () => {
        const entries = await originalEntry();
        
        if (entries['main.js'] && !entries['main.js'].includes('./client/dev/noop.js')) {
          // 에러 오버레이 관련 엔트리 제거
          entries['main.js'] = entries['main.js'].filter(entry => 
            !entry.includes('react-dev-overlay') && 
            !entry.includes('hot-reloader')
          );
        }
        
        return entries;
      };
    }
    
    return config;
  },

  // 추가적인 개발 서버 설정
  ...(process.env.NODE_ENV === 'development' && {
    onDemandEntries: {
      websocketPort: 3001,
    }
  })
};

module.exports = nextConfig;
