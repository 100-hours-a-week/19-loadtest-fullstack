import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { ThemeProvider } from '@vapor-ui/core';
import { createThemeConfig } from '@vapor-ui/core';
import '@vapor-ui/core/styles.css';
import '../styles/globals.css';
import Navbar from '../components/Navbar';
import ErrorCounter from '../components/ErrorCounter'; // 새로 만들 컴포넌트

// Create dark theme configuration
const themeConfig = createThemeConfig({
  appearance: 'dark',
  radius: 'md',
  scaling: 1.0,
  colors: {
    primary: '#3b82f6',
    secondary: '#64748b',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    info: '#06b6d4',
  },
});

function MyApp({ Component, pageProps }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // 전역 에러 핸들링 - 기본 에러 오버레이 방지
    const handleError = (event) => {
      // 기본 Next.js 에러 오버레이 표시 방지
      event.preventDefault();
      event.stopPropagation();
      
      // 콘솔에만 에러 로그
      console.error('Runtime Error:', event.error);
      
      // 커스텀 에러 카운터에 에러 전달
      window.dispatchEvent(new CustomEvent('customError', {
        detail: {
          message: event.error?.message || 'Unknown error',
          stack: event.error?.stack,
          timestamp: Date.now()
        }
      }));
      
      return false;
    };

    const handleUnhandledRejection = (event) => {
      // Promise rejection 에러도 방지
      event.preventDefault();
      console.error('Unhandled promise rejection:', event.reason);
      
      window.dispatchEvent(new CustomEvent('customError', {
        detail: {
          message: event.reason?.message || 'Promise rejection',
          stack: event.reason?.stack,
          timestamp: Date.now()
        }
      }));
    };

    // Next.js 개발 모드의 에러 오버레이 강제 제거
    const removeErrorOverlay = () => {
      const overlay = document.querySelector('nextjs-portal');
      if (overlay) {
        overlay.remove();
      }
      
      // React Error Overlay도 제거
      const reactOverlay = document.querySelector('#__next-build-watcher');
      if (reactOverlay) {
        reactOverlay.style.display = 'none';
      }
    };

    // 주기적으로 에러 오버레이 체크 및 제거
    const overlayChecker = setInterval(removeErrorOverlay, 100);

    window.addEventListener('error', handleError, true);
    window.addEventListener('unhandledrejection', handleUnhandledRejection, true);

    return () => {
      clearInterval(overlayChecker);
      window.removeEventListener('error', handleError, true);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection, true);
    };
  }, []);

  if (!mounted) {
    return null;
  }

  const showNavbar = !['/', '/register'].includes(router.pathname);

  return (
    <ThemeProvider config={themeConfig}>
      {showNavbar && <Navbar />}
      <Component {...pageProps} />
      {/* 커스텀 에러 카운터 컴포넌트 추가 */}
      <ErrorCounter />
    </ThemeProvider>
  );
}

export default MyApp;