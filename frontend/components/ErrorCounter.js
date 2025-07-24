import React, { useState, useEffect } from 'react';

const ErrorCounter = () => {
  const [errorCount, setErrorCount] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    const handleCustomError = (event) => {
      const errorDetail = event.detail;
      
      setErrorCount(prev => prev + 1);
      setErrors(prev => [...prev, errorDetail]);
    };

    // 커스텀 에러 이벤트 리스너
    window.addEventListener('customError', handleCustomError);

    return () => {
      window.removeEventListener('customError', handleCustomError);
    };
  }, []);

  const clearErrors = () => {
    setErrorCount(0);
    setErrors([]);
    setShowModal(false);
  };

  if (errorCount === 0) return null;

  return (
    <>
      {/* 하단 고정 에러 카운터 버튼 */}
      <div 
        className="fixed bottom-4 left-4 z-50 cursor-pointer"
        onClick={() => setShowModal(true)}
      >
        <div className="bg-red-500 text-white px-3 py-2 rounded-full shadow-lg hover:bg-red-600 transition-colors flex items-center gap-2">
          <div className="w-3 h-3 bg-white rounded-full flex items-center justify-center">
            <span className="text-red-500 text-xs font-bold">!</span>
          </div>
          <span className="font-medium">{errorCount} error{errorCount > 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* 에러 모달 (수동으로 열기) */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-900 text-white rounded-lg shadow-xl max-w-4xl max-h-96 w-full mx-4 flex flex-col">
            {/* 모달 헤더 */}
            <div className="flex justify-between items-center p-4 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <span className="text-red-400 text-xl">⚠</span>
                <h2 className="text-xl font-bold text-red-400">
                  Unhandled Runtime Error
                </h2>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={clearErrors}
                  className="text-gray-400 hover:text-white px-2 py-1 text-sm border border-gray-600 rounded hover:border-gray-500 transition-colors"
                >
                  Clear
                </button>
                <button 
                  onClick={() => setShowModal(false)}
                  className="text-gray-400 hover:text-white text-2xl leading-none"
                >
                  ×
                </button>
              </div>
            </div>

            {/* 에러 내용 */}
            <div className="flex-1 overflow-auto p-4">
              {errors.map((error, index) => (
                <div key={index} className="mb-6 last:mb-0">
                  {/* 에러 메시지 */}
                  <div className="mb-2">
                    <span className="text-red-400 font-medium">Error: </span>
                    <span className="text-white">{error.message}</span>
                  </div>

                  {/* 에러 스택 */}
                  {error.stack && (
                    <div className="bg-gray-800 rounded p-3 overflow-x-auto">
                      <h3 className="text-sm font-medium text-gray-300 mb-2">Source</h3>
                      <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono">
                        {error.stack}
                      </pre>
                    </div>
                  )}

                  {/* 구분선 */}
                  {index < errors.length - 1 && (
                    <hr className="border-gray-700 mt-4" />
                  )}
                </div>
              ))}
            </div>

            {/* 모달 푸터 */}
            <div className="p-4 border-t border-gray-700 text-sm text-gray-400">
              <p>This error overlay can be dismissed by clicking the X or pressing ESC.</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default ErrorCounter;