// frontend/components/chat/ChatRoom.js - AI 메시지 처리 부분 수정

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import MessageList from './MessageList';
import MessageInput from './MessageInput/MessageInput';
import ParticipantsList from './ParticipantsList';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { messageService } from '../../services/messageService';

const ChatRoom = ({ roomId, roomData, onLeave }) => {
  const router = useRouter();
  const { user } = useAuth();
  const { socket } = useSocket();
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [gameState, setGameState] = useState(null);
  const [mafiaGameState, setMafiaGameState] = useState(null);
  const [privateMessages, setPrivateMessages] = useState([]);
  
  const messagesEndRef = useRef(null);
  const messageListRef = useRef(null);
  const socketRef = useRef(socket);

  // Socket reference 업데이트
  useEffect(() => {
    socketRef.current = socket;
  }, [socket]);

  // 메시지 로딩
  const loadMessages = useCallback(async (page = 0) => {
    if (loadingMessages) return;
    
    setLoadingMessages(true);
    try {
      const data = await messageService.getRoomMessages(roomId, page);
      
      if (page === 0) {
        setMessages(data.messages || []);
      } else {
        setMessages(prev => [...(data.messages || []), ...prev]);
      }
      
      setHasMoreMessages(data.hasMore);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setLoadingMessages(false);
    }
  }, [roomId, loadingMessages]);

  // 초기 메시지 로드
  useEffect(() => {
    if (roomId) {
      loadMessages(0);
    }
  }, [roomId, loadMessages]);

  // Socket 이벤트 리스너 설정
  useEffect(() => {
    if (!socket || !roomId) return;

    // 방 입장
    socket.emit('joinRoom', { room: roomId, user });

    // 메시지 관련 이벤트
    const handleMessage = (message) => {
      console.log('새 메시지 수신:', message);
      setMessages(prev => [...prev, message]);
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    };

    const handleAIMessageStart = (data) => {
      console.log('AI 메시지 시작:', data);
      const aiMessage = {
        _id: data.messageId,
        type: 'ai',
        aiType: data.aiType,
        content: '',
        timestamp: data.timestamp,
        reactions: {},
        isStreaming: true
      };
      setMessages(prev => [...prev, aiMessage]);
    };

    const handleAIMessageChunk = (data) => {
      console.log('AI 메시지 청크:', data.messageId, data.currentChunk);
      setMessages(prev => prev.map(msg => 
        msg._id === data.messageId 
          ? { 
              ...msg, 
              content: data.fullContent || data.currentChunk || '', 
              isStreaming: true 
            }
          : msg
      ));
      
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    };

    const handleAIMessageComplete = (data) => {
      console.log('AI 메시지 완료:', data);
      
      setMessages(prev => prev.map(msg => 
        msg._id === data.messageId 
          ? { 
              ...data.dbMessage, // 데이터베이스에서 온 완전한 메시지 객체 사용
              _id: data.messageId, // messageId 유지
              content: data.fullContent || data.dbMessage?.content || '',
              isStreaming: false,
              timestamp: data.timestamp || data.dbMessage?.timestamp
            }
          : msg
      ));
      
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    };

    const handleAIMessageError = (data) => {
      console.error('AI 메시지 오류:', data);
      setMessages(prev => prev.map(msg => 
        msg._id === data.messageId 
          ? { 
              ...msg, 
              content: `❌ 오류가 발생했습니다: ${data.error}`,
              isStreaming: false,
              hasError: true 
            }
          : msg
      ));
    };

    // 참여자 업데이트
    const handleParticipantsUpdate = (data) => {
      console.log('참여자 업데이트:', data);
      setParticipants(data.participants || []);
    };

    // 게임 상태 업데이트
    const handleGameStateUpdate = (data) => {
      console.log('게임 상태 업데이트:', data);
      setGameState(data.gameState);
    };

    // 마피아 게임 상태 업데이트
    const handleMafiaGameStateUpdate = (data) => {
      console.log('마피아 게임 상태 업데이트:', data);
      setMafiaGameState(data.gameState);
    };

    // 개인 메시지 (마피아 역할 알림) - 수정된 부분
    const handlePrivateMessage = (data) => {
      console.log('개인 메시지 수신:', data);
      
      setPrivateMessages(prev => {
        // 중복 메시지 방지
        const isDuplicate = prev.some(msg => 
          msg.timestamp === data.timestamp && 
          msg.content === data.content &&
          msg.from.id === data.from.id
        );
        
        if (isDuplicate) {
          console.log('중복 개인 메시지 무시:', data);
          return prev;
        }
        
        return [...prev, data];
      });
      
      // 마피아 게임 관련 개인 메시지인 경우 알림 표시
      if (data.gameType === 'mafia') {
        // 브라우저 알림 (권한이 있는 경우)
        if (Notification.permission === 'granted') {
          new Notification('마피아 게임 - 역할 배정', {
            body: '당신의 역할이 배정되었습니다. 채팅방을 확인해주세요.',
            icon: '/icons/mafia-icon.png'
          });
        }
        
        // 시각적 알림 (채팅방 내) - 개선된 버전
        const alertMessage = {
          _id: `private-alert-${Date.now()}`,
          type: 'system',
          content: `🔔 **${data.from.name}**로부터 개인 메시지가 도착했습니다.\n📝 역할 정보를 확인하세요.`,
          timestamp: data.timestamp,
          isPrivateAlert: true,
          reactions: {}
        };
        
        setMessages(prev => [...prev, alertMessage]);
        
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      }
    };

    // 리액션 관련 이벤트
    const handleReactionAdded = (data) => {
      setMessages(prev => prev.map(msg => 
        msg._id === data.messageId 
          ? { ...msg, reactions: data.reactions }
          : msg
      ));
    };

    const handleReactionRemoved = (data) => {
      setMessages(prev => prev.map(msg => 
        msg._id === data.messageId 
          ? { ...msg, reactions: data.reactions }
          : msg
      ));
    };

    // 에러 처리
    const handleError = (error) => {
      console.error('Socket error:', error);
      // 에러 메시지를 사용자에게 표시
      const errorMessage = {
        _id: `error-${Date.now()}`,
        type: 'system',
        content: `❌ ${error.message || '연결 오류가 발생했습니다.'}`,
        timestamp: new Date(),
        isError: true,
        reactions: {}
      };
      
      setMessages(prev => [...prev, errorMessage]);
    };

    // 이벤트 리스너 등록
    socket.on('message', handleMessage);
    socket.on('aiMessageStart', handleAIMessageStart);
    socket.on('aiMessageChunk', handleAIMessageChunk);
    socket.on('aiMessageComplete', handleAIMessageComplete);
    socket.on('aiMessageError', handleAIMessageError);
    socket.on('roomParticipantsUpdate', handleParticipantsUpdate);
    socket.on('gameStateUpdate', handleGameStateUpdate);
    socket.on('mafiaGameStateUpdate', handleMafiaGameStateUpdate);
    socket.on('privateMessage', handlePrivateMessage);
    socket.on('reactionAdded', handleReactionAdded);
    socket.on('reactionRemoved', handleReactionRemoved);
    socket.on('error', handleError);

    // 컴포넌트 언마운트 시 이벤트 리스너 제거
    return () => {
      socket.off('message', handleMessage);
      socket.off('aiMessageStart', handleAIMessageStart);
      socket.off('aiMessageChunk', handleAIMessageChunk);
      socket.off('aiMessageComplete', handleAIMessageComplete);
      socket.off('aiMessageError', handleAIMessageError);
      socket.off('roomParticipantsUpdate', handleParticipantsUpdate);
      socket.off('gameStateUpdate', handleGameStateUpdate);
      socket.off('mafiaGameStateUpdate', handleMafiaGameStateUpdate);
      socket.off('privateMessage', handlePrivateMessage);
      socket.off('reactionAdded', handleReactionAdded);
      socket.off('reactionRemoved', handleReactionRemoved);
      socket.off('error', handleError);
    };
  }, [socket, roomId, user]);

  // 알림 권한 요청 (마피아 게임용)
  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // 리액션 추가
  const handleReactionAdd = useCallback((messageId, emoji) => {
    if (socket) {
      socket.emit('addReaction', {
        messageId,
        emoji,
        room: roomId
      });
    }
  }, [socket, roomId]);

  // 리액션 제거
  const handleReactionRemove = useCallback((messageId, emoji) => {
    if (socket) {
      socket.emit('removeReaction', {
        messageId,
        emoji,
        room: roomId
      });
    }
  }, [socket, roomId]);

  // 더 많은 메시지 로드
  const handleLoadMore = useCallback(() => {
    if (hasMoreMessages && !loadingMessages) {
      const currentPage = Math.ceil(messages.length / 20);
      loadMessages(currentPage);
    }
  }, [hasMoreMessages, loadingMessages, messages.length, loadMessages]);

  // 방 나가기
  const handleLeaveRoom = useCallback(() => {
    if (socket) {
      socket.emit('leaveRoom', roomId);
    }
    if (onLeave) {
      onLeave();
    } else {
      router.push('/');
    }
  }, [socket, roomId, onLeave, router]);

  // 게임 상태 표시를 위한 현재 방 정보 업데이트
  const currentRoom = {
    ...roomData,
    participants: participants.length > 0 ? participants : roomData?.participants || []
  };

  return (
    <div className="flex h-full bg-white">
      {/* 메인 채팅 영역 */}
      <div className="flex-1 flex flex-col">
        {/* 채팅방 헤더 */}
        <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h2 className="text-lg font-semibold text-gray-800">
              {roomData?.name || '채팅방'}
            </h2>
            <span className="text-sm text-gray-500">
              참여자 {participants.length}명
            </span>
            
            {/* 게임 상태 표시 */}
            {mafiaGameState?.isActive && (
              <div className="flex items-center space-x-1 text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">
                <span>🕵️</span>
                <span>마피아 게임 진행 중</span>
              </div>
            )}
            
            {gameState?.isActive && (
              <div className="flex items-center space-x-1 text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                <span>🎮</span>
                <span>업다운 게임 진행 중</span>
              </div>
            )}
          </div>
          
          <button
            onClick={handleLeaveRoom}
            className="text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            나가기
          </button>
        </div>

        {/* 메시지 목록 */}
        <div className="flex-1 overflow-hidden">
          <MessageList
            ref={messageListRef}
            messages={messages}
            currentUser={user}
            onReactionAdd={handleReactionAdd}
            onReactionRemove={handleReactionRemove}
            room={currentRoom}
            socketRef={socketRef}
            onLoadMore={handleLoadMore}
            loadingMessages={loadingMessages}
            hasMoreMessages={hasMoreMessages}
          />
          <div ref={messagesEndRef} />
        </div>

        {/* 메시지 입력 */}
        <MessageInput
          room={currentRoom}
          currentUser={user}
          socketRef={socketRef}
          onLoadMore={handleLoadMore}
          loadingMessages={loadingMessages}
        />
      </div>

      {/* 참여자 목록 사이드바 */}
      <div className="w-64 border-l bg-gray-50">
        <ParticipantsList 
          participants={participants}
          currentUser={user}
          gameState={gameState}
          mafiaGameState={mafiaGameState}
          privateMessages={privateMessages}
        />
      </div>
    </div>
  );
};

export default ChatRoom;