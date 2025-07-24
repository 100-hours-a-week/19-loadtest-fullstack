const Message = require('../models/Message');
const Room = require('../models/Room');
const User = require('../models/User');
const File = require('../models/File');
const jwt = require('jsonwebtoken');
const { jwtSecret } = require('../config/keys');
const redisClient = require('../utils/redisClient');
const SessionService = require('../services/sessionService');
const aiService = require('../services/aiService');

module.exports = function(io) {
  const connectedUsers = new Map();
  const streamingSessions = new Map();
  const userRooms = new Map();
  const messageQueues = new Map();
  const messageLoadRetries = new Map();
  const BATCH_SIZE = 30;  // 한 번에 로드할 메시지 수
  const LOAD_DELAY = 300; // 메시지 로드 딜레이 (ms)
  const MAX_RETRIES = 3;  // 최대 재시도 횟수
  const MESSAGE_LOAD_TIMEOUT = 10000; // 메시지 로드 타임아웃 (10초)
  const RETRY_DELAY = 2000; // 재시도 간격 (2초)
  const DUPLICATE_LOGIN_TIMEOUT = 10000; // 중복 로그인 타임아웃 (10초)

  // 로깅 유틸리티 함수
  const logDebug = (action, data) => {
    console.debug(`[Socket.IO] ${action}:`, {
      ...data,
      timestamp: new Date().toISOString()
    });
  };

  // 메시지 일괄 로드 함수 개선
  const loadMessages = async (socket, roomId, before, limit = BATCH_SIZE) => {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error('Message loading timed out'));
      }, MESSAGE_LOAD_TIMEOUT);
    });

    try {
      // 쿼리 구성
      const query = { room: roomId };
      if (before) {
        query.timestamp = { $lt: new Date(before) };
      }

      // 메시지 로드 with profileImage
      const messages = await Promise.race([
        Message.find(query)
          .populate('sender', 'name email profileImage')
          .populate({
            path: 'file',
            select: 'filename originalname mimetype size'
          })
          .sort({ timestamp: -1 })
          .limit(limit + 1)
          .lean(),
        timeoutPromise
      ]);

      // 결과 처리
      const hasMore = messages.length > limit;
      const resultMessages = messages.slice(0, limit);
      const sortedMessages = resultMessages.sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      );

      // 읽음 상태 비동기 업데이트
      if (sortedMessages.length > 0 && socket.user) {
        const messageIds = sortedMessages.map(msg => msg._id);
        Message.updateMany(
          {
            _id: { $in: messageIds },
            'readers.userId': { $ne: socket.user.id }
          },
          {
            $push: {
              readers: {
                userId: socket.user.id,
                readAt: new Date()
              }
            }
          }
        ).exec().catch(error => {
          console.error('Read status update error:', error);
        });
      }

      return {
        messages: sortedMessages,
        hasMore,
        oldestTimestamp: sortedMessages[0]?.timestamp || null
      };
    } catch (error) {
      if (error.message === 'Message loading timed out') {
        logDebug('message load timeout', {
          roomId,
          before,
          limit
        });
      } else {
        console.error('Load messages error:', {
          error: error.message,
          stack: error.stack,
          roomId,
          before,
          limit
        });
      }
      throw error;
    }
  };

  // 재시도 로직을 포함한 메시지 로드 함수
  const loadMessagesWithRetry = async (socket, roomId, before, retryCount = 0) => {
    const retryKey = `${roomId}:${socket.user.id}`;
    
    try {
      if (messageLoadRetries.get(retryKey) >= MAX_RETRIES) {
        throw new Error('최대 재시도 횟수를 초과했습니다.');
      }

      const result = await loadMessages(socket, roomId, before);
      messageLoadRetries.delete(retryKey);
      return result;

    } catch (error) {
      const currentRetries = messageLoadRetries.get(retryKey) || 0;
      
      if (currentRetries < MAX_RETRIES) {
        messageLoadRetries.set(retryKey, currentRetries + 1);
        const delay = Math.min(RETRY_DELAY * Math.pow(2, currentRetries), 10000);
        
        logDebug('retrying message load', {
          roomId,
          retryCount: currentRetries + 1,
          delay
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        return loadMessagesWithRetry(socket, roomId, before, currentRetries + 1);
      }

      messageLoadRetries.delete(retryKey);
      throw error;
    }
  };

  // 중복 로그인 처리 함수
  const handleDuplicateLogin = async (existingSocket, newSocket) => {
    try {
      // 기존 연결에 중복 로그인 알림
      existingSocket.emit('duplicate_login', {
        type: 'new_login_attempt',
        deviceInfo: newSocket.handshake.headers['user-agent'],
        ipAddress: newSocket.handshake.address,
        timestamp: Date.now()
      });

      // 타임아웃 설정
      return new Promise((resolve) => {
        setTimeout(async () => {
          try {
            // 기존 세션 종료
            existingSocket.emit('session_ended', {
              reason: 'duplicate_login',
              message: '다른 기기에서 로그인하여 현재 세션이 종료되었습니다.'
            });

            // 기존 연결 종료
            existingSocket.disconnect(true);
            resolve();
          } catch (error) {
            console.error('Error during session termination:', error);
            resolve();
          }
        }, DUPLICATE_LOGIN_TIMEOUT);
      });
    } catch (error) {
      console.error('Duplicate login handling error:', error);
      throw error;
    }
  };

  function handleDuplicateSocketConnection(socket) {
    const userId = socket.user?.id;
    if (!userId) return;
  
    const previousSocketId = connectedUsers.get(userId);
    if (previousSocketId && previousSocketId !== socket.id) {
      const previousSocket = io.sockets.sockets.get(previousSocketId);
      if (previousSocket) {
        // 중복 로그인 알림
        previousSocket.emit('duplicate_login', {
          type: 'new_login_attempt',
          deviceInfo: socket.handshake.headers['user-agent'],
          ipAddress: socket.handshake.address,
          timestamp: Date.now()
        });
  
        // 일정 시간 후 이전 연결 종료
        setTimeout(() => {
          previousSocket.emit('session_ended', {
            reason: 'duplicate_login',
            message: '다른 기기에서 로그인하여 현재 세션이 종료되었습니다.'
          });
          previousSocket.disconnect(true);
        }, DUPLICATE_LOGIN_TIMEOUT);
      }
    }
  
    // 현재 소켓을 연결 목록에 저장
    connectedUsers.set(userId, socket.id);
  }  

  async function handleFetchPreviousMessages(socket, roomId, before) {
    const userId = socket.user?.id;
    const queueKey = `${roomId}:${userId}`;
  
    try {
      if (!userId) throw new Error('Unauthorized');
  
      const room = await Room.findOne({ _id: roomId, participants: userId });
      if (!room) throw new Error('채팅방 접근 권한이 없습니다.');
  
      if (messageQueues.get(queueKey)) {
        logDebug('message load skipped - already loading', { roomId, userId });
        return;
      }
  
      messageQueues.set(queueKey, true);
      socket.emit('messageLoadStart');
  
      const result = await loadMessagesWithRetry(socket, roomId, before);
  
      logDebug('previous messages loaded', {
        roomId,
        messageCount: result.messages.length,
        hasMore: result.hasMore,
        oldestTimestamp: result.oldestTimestamp
      });
  
      socket.emit('previousMessagesLoaded', result);
  
    } catch (error) {
      console.error('Fetch previous messages error:', error);
      socket.emit('error', {
        type: 'LOAD_ERROR',
        message: error.message || '이전 메시지를 불러오는 중 오류가 발생했습니다.'
      });
    } finally {
      setTimeout(() => {
        messageQueues.delete(queueKey);
      }, LOAD_DELAY);
    }
  }
  
  async function handleJoinRoom(socket, roomId) {
    try {
      const userId = socket.user?.id;
      if (!userId) throw new Error('Unauthorized');
  
      const currentRoom = userRooms.get(userId);
      if (currentRoom === roomId) {
        logDebug('already in room', { userId, roomId });
        socket.emit('joinRoomSuccess', { roomId });
        return;
      }
  
      // 현재 방 나가기
      if (currentRoom) {
        logDebug('leaving current room', { userId, roomId: currentRoom });
        socket.leave(currentRoom);
        userRooms.delete(userId);
  
        socket.to(currentRoom).emit('userLeft', {
          userId,
          name: socket.user.name
        });
      }
  
      // 참가자 추가 및 정보 조회
      const room = await Room.findByIdAndUpdate(
        roomId,
        { $addToSet: { participants: userId } },
        { new: true, runValidators: true }
      ).populate('participants', 'name email profileImage');
  
      if (!room) throw new Error('채팅방을 찾을 수 없습니다.');
  
      socket.join(roomId);
      userRooms.set(userId, roomId);
  
      // 입장 메시지
      const joinMessage = await new Message({
        room: roomId,
        content: `${socket.user.name}님이 입장하였습니다.`,
        type: 'system',
        timestamp: new Date()
      }).save();
  
      // 메시지 로딩
      const { messages, hasMore, oldestTimestamp } = await loadMessages(socket, roomId);
  
      // 스트리밍 메시지
      const activeStreams = Array.from(streamingSessions.values())
        .filter(session => session.room === roomId)
        .map(session => ({
          _id: session.messageId,
          type: 'ai',
          aiType: session.aiType,
          content: session.content,
          timestamp: session.timestamp,
          isStreaming: true
        }));
  
      // 응답 전송
      socket.emit('joinRoomSuccess', {
        roomId,
        participants: room.participants,
        messages,
        hasMore,
        oldestTimestamp,
        activeStreams
      });
  
      io.to(roomId).emit('message', joinMessage);
      io.to(roomId).emit('participantsUpdate', room.participants);
  
      logDebug('user joined room', {
        userId,
        roomId,
        messageCount: messages.length,
        hasMore
      });
  
    } catch (error) {
      console.error('Join room error:', error);
      socket.emit('joinRoomError', {
        message: error.message || '채팅방 입장에 실패했습니다.'
      });
    }
  }  

  async function handleChatMessage(socket, messageData) {
    try {
      if (!socket.user) throw new Error('Unauthorized');
      if (!messageData) throw new Error('메시지 데이터가 없습니다.');
  
      const { room, type, content, fileData } = messageData;
      const userId = socket.user.id;
  
      if (!room) throw new Error('채팅방 정보가 없습니다.');
  
      const chatRoom = await Room.findOne({ _id: room, participants: userId });
      if (!chatRoom) throw new Error('채팅방 접근 권한이 없습니다.');
  
      const sessionValidation = await SessionService.validateSession(userId, socket.user.sessionId);
      if (!sessionValidation.isValid) {
        throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.');
      }
  
      const aiMentions = extractAIMentions(content);
      let message = await createMessage(socket, type, content, fileData, messageData);
  
      await message.save();
      await message.populate([
        { path: 'sender', select: 'name email profileImage' },
        { path: 'file', select: 'filename originalname mimetype size' }
      ]);
  
      io.to(room).emit('message', message);
  
      if (aiMentions.length > 0) {
        for (const ai of aiMentions) {
          const query = content.replace(new RegExp(`@${ai}\\b`, 'g'), '').trim();
          await handleAIResponse(io, room, ai, query);
        }
      }
  
      await SessionService.updateLastActivity(userId);
  
      logDebug('message processed', {
        messageId: message._id,
        type: message.type,
        room
      });
  
    } catch (error) {
      console.error('Message handling error:', error);
      socket.emit('error', {
        code: error.code || 'MESSAGE_ERROR',
        message: error.message || '메시지 전송 중 오류가 발생했습니다.'
      });
    }
  }
  
  async function createMessage(socket, type, content, fileData, messageData) {
    const userId = socket.user.id;
    const room = messageData.room;
  
    switch (type) {
      case 'file': {
        if (!fileData || !fileData._id) {
          throw new Error('파일 데이터가 올바르지 않습니다.');
        }
  
        const file = await File.findOne({ _id: fileData._id, user: userId });
        if (!file) {
          throw new Error('파일을 찾을 수 없거나 접근 권한이 없습니다.');
        }
  
        return new Message({
          room,
          sender: userId,
          type: 'file',
          file: file._id,
          content: content || '',
          timestamp: new Date(),
          reactions: {},
          metadata: {
            fileType: file.mimetype,
            fileSize: file.size,
            originalName: file.originalname
          }
        });
      }
  
      case 'text': {
        const messageContent = content?.trim() || messageData.msg?.trim();
        if (!messageContent) return;
  
        return new Message({
          room,
          sender: userId,
          content: messageContent,
          type: 'text',
          timestamp: new Date(),
          reactions: {}
        });
      }
  
      default:
        throw new Error('지원하지 않는 메시지 타입입니다.');
    }
  }

  async function handleLeaveRoom(socket, roomId) {
    try {
      const userId = socket.user?.id;
      if (!userId) throw new Error('Unauthorized');
  
      const currentRoom = userRooms?.get(userId);
      if (!currentRoom || currentRoom !== roomId) {
        console.log(`User ${userId} is not in room ${roomId}`);
        return;
      }
  
      const room = await Room.findOne({
        _id: roomId,
        participants: userId
      }).select('participants').lean();
  
      if (!room) {
        console.log(`Room ${roomId} not found or user has no access`);
        return;
      }
  
      socket.leave(roomId);
      userRooms.delete(userId);
  
      const leaveMessage = await Message.create({
        room: roomId,
        content: `${socket.user.name}님이 퇴장하였습니다.`,
        type: 'system',
        timestamp: new Date()
      });
  
      const updatedRoom = await Room.findByIdAndUpdate(
        roomId,
        { $pull: { participants: userId } },
        { new: true, runValidators: true }
      ).populate('participants', 'name email profileImage');
  
      if (!updatedRoom) {
        console.log(`Room ${roomId} not found during update`);
        return;
      }
  
      cleanUpStreamingSessions(userId, roomId);
      cleanUpMessageQueues(userId, roomId);
  
      io.to(roomId).emit('message', leaveMessage);
      io.to(roomId).emit('participantsUpdate', updatedRoom.participants);
  
      console.log(`User ${userId} left room ${roomId} successfully`);
  
    } catch (error) {
      console.error('Leave room error:', error);
      socket.emit('error', {
        message: error.message || '채팅방 퇴장 중 오류가 발생했습니다.'
      });
    }
  }
  
  async function handleDisconnect(socket, reason) {
    const userId = socket.user.id;
  
    try {
      // 현재 연결된 소켓인지 확인하고 제거
      if (connectedUsers.get(userId) === socket.id) {
        connectedUsers.delete(userId);
      }
  
      const roomId = userRooms.get(userId);
      userRooms.delete(userId);
  
      // 메시지 큐 정리
      cleanUpMessageQueues(userId);
  
      // 스트리밍 세션 정리
      cleanUpStreamingSessions(userId);
  
      // 현재 방 퇴장 메시지 전송 (중복 로그인 등의 경우는 제외)
      if (
        roomId &&
        reason !== 'client namespace disconnect' &&
        reason !== 'duplicate_login'
      ) {
        await handleDisconnectLeaveMessage(roomId, socket);
      }
  
      logDebug('user disconnected', {
        reason,
        userId,
        socketId: socket.id,
        lastRoom: roomId
      });
  
    } catch (error) {
      console.error('Disconnect handling error:', error);
    }
  }

  async function handleForceLogin(socket, token) {
    try {
      if (!socket.user) return;
  
      const decoded = jwt.verify(token, jwtSecret);
      const userId = decoded?.user?.id;
  
      if (!userId || userId !== socket.user.id) {
        throw new Error('Invalid token');
      }
  
      socket.emit('session_ended', {
        reason: 'force_logout',
        message: '다른 기기에서 로그인하여 현재 세션이 종료되었습니다.'
      });
  
      socket.disconnect(true);
  
    } catch (error) {
      console.error('Force login error:', error);
      socket.emit('error', {
        message: '세션 종료 중 오류가 발생했습니다.'
      });
    }
  }
  
  async function handleMarkMessagesAsRead(socket, roomId, messageIds) {
    try {
      const userId = socket.user?.id;
      if (!userId) throw new Error('Unauthorized');
  
      if (!Array.isArray(messageIds) || messageIds.length === 0) {
        return;
      }
  
      await Message.updateMany(
        {
          _id: { $in: messageIds },
          room: roomId,
          'readers.userId': { $ne: userId }
        },
        {
          $push: {
            readers: {
              userId,
              readAt: new Date()
            }
          }
        }
      );
  
      socket.to(roomId).emit('messagesRead', {
        userId,
        messageIds
      });
  
    } catch (error) {
      console.error('Mark messages as read error:', error);
      socket.emit('error', {
        message: '읽음 상태 업데이트 중 오류가 발생했습니다.'
      });
    }
  }
  
  async function handleMessageReaction(socket, messageId, reaction, type) {
    try {
      const userId = socket.user?.id;
      if (!userId) throw new Error('Unauthorized');
  
      const message = await Message.findById(messageId);
      if (!message) throw new Error('메시지를 찾을 수 없습니다.');
  
      if (type === 'add') {
        await message.addReaction(reaction, userId);
      } else if (type === 'remove') {
        await message.removeReaction(reaction, userId);
      } else {
        throw new Error('지원하지 않는 리액션 타입입니다.');
      }
  
      io.to(message.room).emit('messageReactionUpdate', {
        messageId,
        reactions: message.reactions
      });
  
    } catch (error) {
      console.error('Message reaction error:', error);
      socket.emit('error', {
        message: error.message || '리액션 처리 중 오류가 발생했습니다.'
      });
    }
  }  

  // 미들웨어: 소켓 연결 시 인증 처리
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      const sessionId = socket.handshake.auth.sessionId;

      if (!token || !sessionId) {
        return next(new Error('Authentication error'));
      }

      const decoded = jwt.verify(token, jwtSecret);
      if (!decoded?.user?.id) {
        return next(new Error('Invalid token'));
      }

      // 이미 연결된 사용자인지 확인
      const existingSocketId = connectedUsers.get(decoded.user.id);
      if (existingSocketId) {
        const existingSocket = io.sockets.sockets.get(existingSocketId);
        if (existingSocket) {
          // 중복 로그인 처리
          await handleDuplicateLogin(existingSocket, socket);
        }
      }

      const validationResult = await SessionService.validateSession(decoded.user.id, sessionId);
      if (!validationResult.isValid) {
        console.error('Session validation failed:', validationResult);
        return next(new Error(validationResult.message || 'Invalid session'));
      }

      const user = await User.findById(decoded.user.id);
      if (!user) {
        return next(new Error('User not found'));
      }

      socket.user = {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        sessionId: sessionId,
        profileImage: user.profileImage
      };

      await SessionService.updateLastActivity(decoded.user.id);
      next();

    } catch (error) {
      console.error('Socket authentication error:', error);
      
      if (error.name === 'TokenExpiredError') {
        return next(new Error('Token expired'));
      }
      
      if (error.name === 'JsonWebTokenError') {
        return next(new Error('Invalid token'));
      }
      
      next(new Error('Authentication failed'));
    }
  });
  
  io.on('connection', (socket) => {
    logDebug('socket connected', {
      socketId: socket.id,
      userId: socket.user?.id,
      userName: socket.user?.name
    });

    // 이전 연결이 있는지 확인
    if (socket.user) {
      handleDuplicateSocketConnection(socket);
    }
    
    // 이전 메시지 로딩 처리 개선
    socket.on('fetchPreviousMessages', async ({ roomId, before } = {}) => {
      await handleFetchPreviousMessages(socket, roomId, before);
    });
    
    
    // 채팅방 입장 처리 개선
    socket.on('joinRoom', async (roomId) => {
      await handleJoinRoom(socket, roomId);
    });
    
    // 메시지 전송 처리
    socket.on('chatMessage', async (messageData) => {
      await handleChatMessage(socket, messageData);
    });
    
    // 채팅방 퇴장 처리
    socket.on('leaveRoom', async (roomId) => {
      await handleLeaveRoom(socket, roomId);
    });
    
    // 연결 해제 처리
    socket.on('disconnect', async (reason) => {
      if (!socket.user) return;
      await handleDisconnect(socket, reason);
    });

    // 세션 종료 또는 로그아웃 처리
    socket.on('force_login', async ({ token }) => {
      await handleForceLogin(socket, token);
    });

    // 메시지 읽음 상태 처리
    socket.on('markMessagesAsRead', async ({ roomId, messageIds }) => {
      await handleMarkMessagesAsRead(socket, roomId, messageIds);
    });

    // 리액션 처리
    socket.on('messageReaction', async ({ messageId, reaction, type }) => {
      await handleMessageReaction(socket, messageId, reaction, type);
    });
  });

  // AI 멘션 추출 함수
  function extractAIMentions(content) {
    if (!content) return [];
    
    const aiTypes = ['wayneAI', 'consultingAI'];
    const mentions = new Set();
    const mentionRegex = /@(wayneAI|consultingAI)\b/g;
    let match;
    
    while ((match = mentionRegex.exec(content)) !== null) {
      if (aiTypes.includes(match[1])) {
        mentions.add(match[1]);
      }
    }
    
    return Array.from(mentions);
  }

  // AI 응답 처리 함수 개선
  async function handleAIResponse(io, room, aiName, query) {
    const messageId = `${aiName}-${Date.now()}`;
    let accumulatedContent = '';
    const timestamp = new Date();

    // 스트리밍 세션 초기화
    streamingSessions.set(messageId, {
      room,
      aiType: aiName,
      content: '',
      messageId,
      timestamp,
      lastUpdate: Date.now(),
      reactions: {}
    });
    
    logDebug('AI response started', {
      messageId,
      aiType: aiName,
      room,
      query
    });

    // 초기 상태 전송
    io.to(room).emit('aiMessageStart', {
      messageId,
      aiType: aiName,
      timestamp
    });

    try {
      // AI 응답 생성 및 스트리밍
      await aiService.generateResponse(query, aiName, {
        onStart: () => {
          logDebug('AI generation started', {
            messageId,
            aiType: aiName
          });
        },
        onChunk: async (chunk) => {
          accumulatedContent += chunk.currentChunk || '';
          
          const session = streamingSessions.get(messageId);
          if (session) {
            session.content = accumulatedContent;
            session.lastUpdate = Date.now();
          }

          io.to(room).emit('aiMessageChunk', {
            messageId,
            currentChunk: chunk.currentChunk,
            fullContent: accumulatedContent,
            isCodeBlock: chunk.isCodeBlock,
            timestamp: new Date(),
            aiType: aiName,
            isComplete: false
          });
        },
        onComplete: async (finalContent) => {
          // 스트리밍 세션 정리
          streamingSessions.delete(messageId);

          // AI 메시지 저장
          const aiMessage = await Message.create({
            room,
            content: finalContent.content,
            type: 'ai',
            aiType: aiName,
            timestamp: new Date(),
            reactions: {},
            metadata: {
              query,
              generationTime: Date.now() - timestamp,
              completionTokens: finalContent.completionTokens,
              totalTokens: finalContent.totalTokens
            }
          });

          // 완료 메시지 전송
          io.to(room).emit('aiMessageComplete', {
            messageId,
            _id: aiMessage._id,
            content: finalContent.content,
            aiType: aiName,
            timestamp: new Date(),
            isComplete: true,
            query,
            reactions: {}
          });

          logDebug('AI response completed', {
            messageId,
            aiType: aiName,
            contentLength: finalContent.content.length,
            generationTime: Date.now() - timestamp
          });
        },
        onError: (error) => {
          streamingSessions.delete(messageId);
          console.error('AI response error:', error);
          
          io.to(room).emit('aiMessageError', {
            messageId,
            error: error.message || 'AI 응답 생성 중 오류가 발생했습니다.',
            aiType: aiName
          });

          logDebug('AI response error', {
            messageId,
            aiType: aiName,
            error: error.message
          });
        }
      });
    } catch (error) {
      streamingSessions.delete(messageId);
      console.error('AI service error:', error);
      
      io.to(room).emit('aiMessageError', {
        messageId,
        error: error.message || 'AI 서비스 오류가 발생했습니다.',
        aiType: aiName
      });

      logDebug('AI service error', {
        messageId,
        aiType: aiName,
        error: error.message
      });
    }
  }

  return io;
};