import React, { useRef, useEffect, useState } from 'react';
import EmojiPicker from './EmojiPicker';
import MentionList from './MentionList';
import FilePreview from './FilePreview';
import GameStatus from '../Game/GameStatus';
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

    socketRef.current.on('gameStateUpdate', handleGameStateUpdate);

    return () => {
      socketRef.current?.off('gameStateUpdate', handleGameStateUpdate);
    };
  }, [socketRef]);

  // 게임 중일 때 숫자 입력 감지
  const isGameActive = gameState?.isActive;
  const isNumberInput = /^\d{1,3}$/.test(message.trim()) && 
                       parseInt(message.trim()) >= 1 && 
                       parseInt(message.trim()) <= 100;

  // 메시지 입력 플레이스홀더 동적 변경
  const getPlaceholder = () => {
    if (isGameActive) {
      return "1-100 사이의 숫자를 입력하세요... (게임 진행 중)";
    }
    return "메시지를 입력하세요... (@wayneAI 또는 @consultingAI로 AI 호출)";
  };

  // 전송 버튼 텍스트 동적 변경
  const getSubmitButtonText = () => {
    if (isGameActive && isNumberInput) {
      return "추측하기";
    }
    return "전송";
  };

  // 입력창 스타일 동적 변경
  const getInputClassName = () => {
    let baseClass = "flex-1 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:border-transparent";
    
    if (isGameActive) {
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
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredParticipants[mentionIndex]) {
          insertMention(messageInputRef, filteredParticipants[mentionIndex]);
        }
        return;
      } else if (e.key === 'Escape') {
        setShowMentionList(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleMessageSubmit(e);
    }
  };

  return (
    <div className="message-input-container">
      {/* 게임 상태 표시 */}
      <GameStatus gameState={gameState} isVisible={isGameActive} />
      
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

      <div className="flex items-end space-x-3 p-4 bg-white border-t border-gray-200 relative">
        {/* 멘션 리스트 */}
        {showMentionList && (
          <MentionList
            participants={filteredParticipants}
            selectedIndex={mentionIndex}
            onSelect={(user) => insertMention(messageInputRef, user)}
            onClose={() => setShowMentionList(false)}
          />
        )}

        {/* 이모지 피커 */}
        {showEmojiPicker && (
          <EmojiPicker
            onEmojiSelect={(emoji) => {
              setMessage(prev => prev + emoji);
              setShowEmojiPicker(false);
              messageInputRef.current?.focus();
            }}
            onClose={() => setShowEmojiPicker(false)}
          />
        )}

        {/* 이모지 버튼 */}
        <button
          type="button"
          onClick={handleEmojiToggle}
          className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
          title="이모지 추가"
        >
          😀
        </button>

        {/* 메시지 입력창 */}
        <div className="flex-1 relative">
          <textarea
            ref={messageInputRef}
            value={message}
            onChange={handleMessageChange}
            onKeyDown={handleKeyDown}
            placeholder={getPlaceholder()}
            className={getInputClassName()}
            rows={1}
            style={{
              minHeight: '44px',
              maxHeight: '120px'
            }}
          />
          
          {/* 게임 힌트 표시 */}
          {isGameActive && !isNumberInput && message.length > 0 && (
            <div className="absolute -top-8 left-0 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded">
              💡 1-100 사이의 숫자를 입력해주세요
            </div>
          )}
        </div>

        {/* 전송 버튼 */}
        <button
          type="submit"
          onClick={handleMessageSubmit}
          disabled={!message.trim() || uploading}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            !message.trim() || uploading
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : isGameActive && isNumberInput
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {uploading ? '업로드 중...' : getSubmitButtonText()}
        </button>
      </div>
    </div>
  );
};

export default MessageInput;