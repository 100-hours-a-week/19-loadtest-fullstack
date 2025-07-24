import React from 'react';

const GameStatus = ({ gameState, isVisible }) => {
  if (!isVisible || !gameState) return null;

  return (
    <div className="game-status-banner bg-gradient-to-r from-blue-500 to-purple-600 text-white p-3 rounded-lg mb-4 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-8 h-8 bg-white bg-opacity-20 rounded-full">
            🎮
          </div>
          <div>
            <div className="font-bold text-sm">업다운 게임 진행 중</div>
            <div className="text-xs opacity-90">
              시도 횟수: {gameState.attempts}회 
              {gameState.lastGuess && ` | 마지막 추측: ${gameState.lastGuess}`}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs opacity-75">범위: 1-100</div>
          <div className="text-xs opacity-75">@호출 없이 숫자만 입력</div>
        </div>
      </div>
    </div>
  );
};

export default GameStatus;