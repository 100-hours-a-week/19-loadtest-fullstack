import React, { useState, useEffect } from 'react';

const MafiaGameStatus = ({ 
  mafiaGameState, 
  currentUser, 
  socketRef, 
  room 
}) => {
  const [privateMessages, setPrivateMessages] = useState([]);
  const [showPrivateMessages, setShowPrivateMessages] = useState(false);

  useEffect(() => {
    if (!socketRef?.current) return;

    const handlePrivateMessage = (data) => {
      if (data.gameType === 'mafia') {
        setPrivateMessages(prev => [...prev, data]);
        setShowPrivateMessages(true);
      }
    };

    socketRef.current.on('privateMessage', handlePrivateMessage);

    return () => {
      socketRef.current?.off('privateMessage', handlePrivateMessage);
    };
  }, [socketRef]);

  if (!mafiaGameState?.isActive) {
    return null;
  }

  const getPhaseText = () => {
    switch (mafiaGameState.phase) {
      case 'night':
        return '🌙 밤';
      case 'day':
        return '☀️ 낮 (토론)';
      case 'voting':
        return '🗳️ 투표';
      default:
        return '게임 진행 중';
    }
  };

  const getAliveParticipants = () => {
    return mafiaGameState.participants?.filter(p => 
      mafiaGameState.alive?.includes(p.id)
    ) || [];
  };

  const getDeadParticipants = () => {
    return mafiaGameState.participants?.filter(p => 
      !mafiaGameState.alive?.includes(p.id)
    ) || [];
  };

  const aliveParticipants = getAliveParticipants();
  const deadParticipants = getDeadParticipants();

  return (
    <div className="bg-gradient-to-r from-red-50 to-gray-50 border-l-4 border-red-500 p-4 mb-4 rounded-lg shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <span className="text-2xl">🕵️</span>
          <div>
            <h3 className="font-semibold text-gray-800">마피아 게임 진행 중</h3>
            <p className="text-sm text-gray-600">
              {getPhaseText()} | {mafiaGameState.day}일차
            </p>
          </div>
        </div>
        
        {privateMessages.length > 0 && (
          <button
            onClick={() => setShowPrivateMessages(!showPrivateMessages)}
            className="bg-red-500 text-white px-3 py-1 rounded-full text-sm hover:bg-red-600 transition-colors relative"
          >
            역할 정보
            {privateMessages.length > 0 && (
              <span className="absolute -top-1 -right-1 bg-yellow-400 text-red-800 text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {privateMessages.length}
              </span>
            )}
          </button>
        )}
      </div>

      {/* 생존자 목록 */}
      <div className="mb-3">
        <h4 className="text-sm font-medium text-gray-700 mb-2">
          생존자 ({aliveParticipants.length}명)
        </h4>
        <div className="flex flex-wrap gap-2">
          {aliveParticipants.map(participant => (
            <span
              key={participant.id}
              className="bg-green-100 text-green-800 px-2 py-1 rounded-full text-sm border border-green-200"
            >
              {participant.name}
              {participant.id === currentUser.id && (
                <span className="ml-1 text-xs">(나)</span>
              )}
            </span>
          ))}
        </div>
      </div>

      {/* 사망자 목록 (있는 경우) */}
      {deadParticipants.length > 0 && (
        <div className="mb-3">
          <h4 className="text-sm font-medium text-gray-700 mb-2">
            사망자 ({deadParticipants.length}명)
          </h4>
          <div className="flex flex-wrap gap-2">
            {deadParticipants.map(participant => (
              <span
                key={participant.id}
                className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full text-sm border border-gray-200 line-through"
              >
                {participant.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 게임 단계별 안내 */}
      <div className="text-xs text-gray-600 mt-3 p-2 bg-white rounded border">
        {mafiaGameState.phase === 'night' && (
          <p>🌙 밤이 되었습니다. "토론시작"이라고 입력하여 낮을 시작하세요.</p>
        )}
        {mafiaGameState.phase === 'day' && (
          <p>☀️ 토론 시간입니다. 의심스러운 사람에 대해 이야기하고 "투표시작"으로 투표를 진행하세요.</p>
        )}
        {mafiaGameState.phase === 'voting' && (
          <p>🗳️ 투표 중입니다. "투표 [이름]" 형식으로 투표하세요. (예: 투표 홍길동)</p>
        )}
      </div>

      {/* 개인 메시지 모달 */}
      {showPrivateMessages && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-96 overflow-y-auto">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">개인 메시지</h3>
              <button
                onClick={() => setShowPrivateMessages(false)}
                className="text-gray-500 hover:text-gray-700"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-3">
              {privateMessages.map((msg, index) => (
                <div key={index} className="border-l-4 border-blue-500 pl-3 py-2 bg-blue-50 rounded">
                  <div className="text-sm text-gray-600 mb-1">
                    {msg.from.name} • {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
            
            <button
              onClick={() => setShowPrivateMessages(false)}
              className="mt-4 w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MafiaGameStatus;