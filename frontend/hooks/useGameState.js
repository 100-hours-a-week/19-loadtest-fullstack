import { useState, useEffect, useCallback } from 'react';

const useGameState = (socketRef, currentUser, room) => {
  const [gameState, setGameState] = useState(null);
  const [gameHistory, setGameHistory] = useState([]);

  // 게임 상태 업데이트 핸들러
  const handleGameStateUpdate = useCallback((data) => {
    setGameState(data.gameState);
    
    if (data.gameState?.lastGuess) {
      setGameHistory(prev => [...prev, {
        guess: data.gameState.lastGuess,
        attempts: data.gameState.attempts,
        timestamp: new Date()
      }]);
    }
  }, []);

  // 게임 종료 핸들러  
  const handleGameEnd = useCallback((data) => {
    setGameState(null);
    setGameHistory([]);
  }, []);

  // 소켓 이벤트 리스너 등록
  useEffect(() => {
    if (!socketRef?.current) return;

    socketRef.current.on('gameStateUpdate', handleGameStateUpdate);
    socketRef.current.on('gameEnd', handleGameEnd);

    return () => {
      socketRef.current?.off('gameStateUpdate', handleGameStateUpdate);
      socketRef.current?.off('gameEnd', handleGameEnd);
    };
  }, [socketRef, handleGameStateUpdate, handleGameEnd]);

  // 게임 시작 함수
  const startGame = useCallback(() => {
    if (!socketRef?.current || !room?.id) return;
    
    socketRef.current.emit('startGame', {
      roomId: room.id,
      userId: currentUser?.id
    });
  }, [socketRef, room, currentUser]);

  // 게임 종료 함수
  const endGame = useCallback(() => {
    if (!socketRef?.current || !room?.id) return;
    
    socketRef.current.emit('endGame', {
      roomId: room.id,
      userId: currentUser?.id
    });
  }, [socketRef, room, currentUser]);

  // 숫자 추측 함수
  const makeGuess = useCallback((number) => {
    if (!socketRef?.current || !room?.id || !gameState?.isActive) return;
    
    socketRef.current.emit('message', {
      room: room.id,
      content: number.toString(),
      type: 'text'
    });
  }, [socketRef, room, gameState]);

  // 게임 진행 여부 체크
  const isGameActive = gameState?.isActive || false;

  // 게임 통계 계산
  const gameStats = {
    attempts: gameState?.attempts || 0,
    lastGuess: gameState?.lastGuess,
    startTime: gameState?.startTime,
    history: gameHistory
  };

  return {
    gameState,
    gameHistory,
    gameStats,
    isGameActive,
    startGame,
    endGame,
    makeGuess
  };
};

export default useGameState;