import React, { useRef, useEffect, useState } from 'react';
import EmojiPicker from './EmojiPicker';
import MentionList from './MentionList';
import FilePreview from './FilePreview';
import GameStatus from '../Game/GameStatus';
import MafiaGameStatus from '../Game/MafiaGameStatus';
import useMessageHandling from '../../../hooks/useMessageHandling';

const MessageInput = ({ 
  room, 
  currentUser, 
  socketRef, 
  onLoadMore,
  loadingMessages 
}) => {
  const messageInputRef = useRef(null);
  const [gameState, setGameState] = useState(null);
  const [mafiaGameState, setMafiaGameState] = useState(null);
  
  const {
    message,
    showEmojiPicker,
    showMentionList,
    mentionFilter,
    mentionIndex,
    filePreview,
    uploading,
    uploadProgress,
    uploadError,
    setMessage,
    setShowEmojiPicker,
    setShowMentionList,
    setMentionFilter,
    setMentionIndex,
    handleMessageChange,
    handleMessageSubmit,
    handleEmojiToggle,
    handleLoadMore,
    getFilteredParticipants,
    insertMention,
    removeFilePreview
  } = useMessageHandling({
    room,
    currentUser,
    socketRef,
    onLoadMore,
    loadingMessages,
    messageInputRef
  });

  // 게임 상태 업데이트 리스너
  useEffect(() => {
    if (!socketRef?.current) return;

    const handleGameStateUpdate = (data) => {
      setGameState(data.gameState);
    };

    const handleMafiaGameStateUpdate = (data) => {
      setMafiaGameState(data.gameState);
    };

    socketRef.current.on('gameStateUpdate', handleGameStateUpdate);
    socketRef.current.on('mafiaGameStateUpdate', handleMafiaGameStateUpdate);

    return () => {
      socketRef.current?.off('gameStateUpdate', handleGameStateUpdate);
      socketRef.current?.off('mafiaGameStateUpdate', handleMafiaGameStateUpdate);
    };
  }, [socketRef]);

  // 현재 활성 게임 확인
  const isUpDownGameActive = gameState?.isActive;
  const isMafiaGameActive = mafiaGameState?.isActive;
  const isAnyGameActive = isUpDownGameActive || isMafiaGameActive;

  // 입력 유형 분석
  const isNumberInput = /^\d{1,3}$/.test(message.trim()) && 
                       parseInt(message.trim()) >= 1 && 
                       parseInt(message.trim()) <= 100;
  
  const isVoteCommand = /^투표\s+.+$/i.test(message.trim());
  const isMafiaCommand = ['토론시작', '투표시작'].some(cmd => message.includes(cmd));

  // 메시지 입력 플레이스홀더 동적 변경
  const getPlaceholder = () => {
    if (isMafiaGameActive) {
      switch (mafiaGameState.phase) {
        case 'night':
          return '"토론시작"을 입력하여 낮을 시작하세요...';
        case 'day':
          return '토론 중... "투표시작"으로 투표를 시작하세요...';
        case 'voting':
          return '"투표 [이름]" 형식으로 투표하세요... (예: 투표 홍길동)';
        default:
          return '마피아 게임 진행 중...';
      }
    }
    
    if (isUpDownGameActive) {
      return "1-100 사이의 숫자를 입력하세요... (업다운 게임 진행 중)";
    }
    
    return "메시지를 입력하세요... (@wayneAI 또는 @consultingAI로 AI 호출)";
  };

  // 전송 버튼 텍스트 동적 변경
  const getSubmitButtonText = () => {
    if (isMafiaGameActive) {
      if (isVoteCommand) {
        return "투표하기";
      }
      if (isMafiaCommand) {
        return "게임 진행";
      }
      return "전송";
    }
    
    if (isUpDownGameActive && isNumberInput) {
      return "추측하기";
    }
    
    return "전송";
  };

  // 입력창 스타일 동적 변경
  const getInputClassName = () => {
    let baseClass = "flex-1 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:border-transparent";
    
    if (isMafiaGameActive) {
      if (isVoteCommand) {
        baseClass += " focus:ring-red-500 border-red-300 bg-red-50";
      } else if (isMafiaCommand) {
        baseClass += " focus:ring-purple-500 border-purple-300 bg-purple-50";
      } else {
        baseClass += " focus:ring-orange-500 border-orange-300 bg-orange-50";
      }
    } else if (isUpDownGameActive) {
      if (isNumberInput) {
        baseClass += " focus:ring-green-500 border-green-300 bg-green-50";
      } else {
        baseClass += " focus:ring-blue-500 border-blue-300 bg-blue-50";
      }
    } else {
      baseClass += " focus:ring-blue-500";
    }
    
    return baseClass;
  };

  // 전송 버튼 스타일 동적 변경
  const getSubmitButtonClassName = () => {
    let baseClass = "px-4 py-3 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2";
    
    if (isMafiaGameActive) {
      if (isVoteCommand) {
        baseClass += " bg-red-600 text-white hover:bg-red-700 focus:ring-red-500";
      } else if (isMafiaCommand) {
        baseClass += " bg-purple-600 text-white hover:bg-purple-700 focus:ring-purple-500";
      } else {
        baseClass += " bg-orange-600 text-white hover:bg-orange-700 focus:ring-orange-500";
      }
    } else if (isUpDownGameActive && isNumberInput) {
      baseClass += " bg-green-600 text-white hover:bg-green-700 focus:ring-green-500";
    } else {
      baseClass += " bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500";
    }
    
    return baseClass;
  };

  const filteredParticipants = getFilteredParticipants(room);

  const handleKeyDown = (e) => {
    if (showMentionList) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionIndex(prev => 
          prev < filteredParticipants.length - 1 ? prev + 1 : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionIndex(prev => 
          prev > 0 ? prev - 1 : filteredParticipants.length - 1
        );
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filteredParticipants[mentionIndex]) {
          insertMention(filteredParticipants[mentionIndex]);
        }
      } else if (e.key === 'Escape') {
        setShowMentionList(false);
        setMentionFilter('');
        setMentionIndex(0);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleMessageSubmit(e);
    }
  };

  return (
    <div className="border-t bg-white p-4">
      {/* 게임 상태 표시 */}
      {isMafiaGameActive && (
        <MafiaGameStatus 
          mafiaGameState={mafiaGameState}
          currentUser={currentUser}
          socketRef={socketRef}
          room={room}
        />
      )}
      
      {isUpDownGameActive && (
        <GameStatus 
          gameState={gameState}
          currentUser={currentUser}
          socketRef={socketRef}
        />
      )}

      {/* 게임 시작 가이드 */}
      {!isAnyGameActive && room?.participants?.length >= 3 && room?.participants?.length <= 5 && (
        <div className="mb-4 p-3 bg-gradient-to-r from-purple-50 to-pink-50 border border-purple-200 rounded-lg">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-2xl">🕵️</span>
            <h3 className="font-medium text-purple-800">마피아 게임 가능!</h3>
          </div>
          <p className="text-sm text-purple-600 mb-2">
            현재 {room?.participants?.length}명이 참여 중입니다. 마피아 게임을 시작할 수 있어요!
          </p>
          <div className="flex space-x-2 text-xs">
            <button
              onClick={() => setMessage('@wayneAI 마피아게임')}
              className="bg-purple-500 text-white px-3 py-1 rounded hover:bg-purple-600 transition-colors"
            >
              마피아 게임 시작
            </button>
            <button
              onClick={() => setMessage('@wayneAI 업다운게임')}
              className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors"
            >
              업다운 게임 시작
            </button>
          </div>
        </div>
      )}

      {/* 게임 인원 부족 안내 */}
      {!isAnyGameActive && room?.participants && (room?.participants?.length < 3 || room?.participants?.length > 5) && (
        <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
          <div className="flex items-center space-x-2 mb-2">
            <span className="text-lg">🎮</span>
            <h3 className="font-medium text-gray-700">게임 안내</h3>
          </div>
          <p className="text-sm text-gray-600 mb-2">
            {room?.participants?.length < 3 
              ? `마피아 게임은 3명 이상이 필요합니다. (현재: ${room?.participants?.length}명)`
              : `마피아 게임은 5명 이하에서만 가능합니다. (현재: ${room?.participants?.length}명)`
            }
          </p>
          <button
            onClick={() => setMessage('@wayneAI 업다운게임')}
            className="bg-blue-500 text-white px-3 py-1 rounded text-xs hover:bg-blue-600 transition-colors"
          >
            업다운 게임 시작
          </button>
        </div>
      )}

      {/* 파일 미리보기 */}
      {filePreview && (
        <FilePreview 
          file={filePreview} 
          onRemove={removeFilePreview}
          uploading={uploading}
          uploadProgress={uploadProgress}
          uploadError={uploadError}
        />
      )}

      {/* 멘션 목록 */}
      {showMentionList && (
        <MentionList 
          participants={filteredParticipants}
          selectedIndex={mentionIndex}
          onSelect={insertMention}
          onClose={() => {
            setShowMentionList(false);
            setMentionFilter('');
            setMentionIndex(0);
          }}
        />
      )}

      {/* 메시지 입력 영역 */}
      <form onSubmit={handleMessageSubmit} className="flex items-end space-x-2">
        <div className="flex-1 relative">
          <textarea
            ref={messageInputRef}
            value={message}
            onChange={handleMessageChange}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder()}
            className={getInputClassName()}
            rows="1"
            style={{
              minHeight: '48px',
              maxHeight: '120px',
              resize: 'none'
            }}
            disabled={uploading}
          />
          
          {/* 게임 힌트 표시 */}
          {isMafiaGameActive && (
            <div className="absolute right-2 top-2 text-xs text-gray-500">
              {mafiaGameState.phase === 'voting' && '투표 형식: 투표 이름'}
            </div>
          )}
        </div>

        {/* 이모지 버튼 */}
        <div className="relative">
          <button
            type="button"
            onClick={handleEmojiToggle}
            className="p-3 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            disabled={uploading}
          >
            😊
          </button>
          
          {showEmojiPicker && (
            <div className="absolute bottom-12 right-0 z-50">
              <EmojiPicker 
                onEmojiSelect={(emoji) => {
                  setMessage(prev => prev + emoji);
                  setShowEmojiPicker(false);
                  messageInputRef.current?.focus();
                }}
                onClose={() => setShowEmojiPicker(false)}
              />
            </div>
          )}
        </div>

        {/* 파일 업로드 버튼 */}
        <label className="p-3 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer">
          <input
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files[0];
              if (file) {
                // 파일 처리 로직 (기존과 동일)
                console.log('File selected:', file);
              }
            }}
            disabled={uploading}
          />
          📎
        </label>

        {/* 전송 버튼 */}
        <button
          type="submit"
          disabled={!message.trim() || uploading}
          className={`${getSubmitButtonClassName()} ${(!message.trim() || uploading) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {uploading ? (
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              <span>업로드 중...</span>
            </div>
          ) : (
            getSubmitButtonText()
          )}
        </button>
      </form>

      {/* 업로드 에러 표시 */}
      {uploadError && (
        <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
          {uploadError}
        </div>
      )}

      {/* 게임 상태별 추가 안내 */}
      {isMafiaGameActive && (
        <div className="mt-2 text-xs text-gray-500 space-y-1">
          <div>💡 <strong>마피아 게임 명령어:</strong></div>
          <div className="ml-4">
            • <code>토론시작</code> - 낮 토론 시작
          </div>
          <div className="ml-4">
            • <code>투표시작</code> - 투표 단계 시작
          </div>
          <div className="ml-4">
            • <code>투표 [이름]</code> - 특정 플레이어에게 투표
          </div>
        </div>
      )}

      {isUpDownGameActive && (
        <div className="mt-2 text-xs text-gray-500">
          💡 1부터 100까지의 숫자를 입력해서 정답을 맞춰보세요!
        </div>
      )}
    </div>
  );
};

export default MessageInput;