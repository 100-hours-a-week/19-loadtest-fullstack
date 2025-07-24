const axios = require('axios');
const { openaiApiKey } = require('../config/keys');

class AIService {
  constructor() {
    this.openaiClient = axios.create({
      baseURL: 'https://api.openai.com/v1',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    // 기존 업다운 게임 상태 관리용 Map
    this.gameStates = new Map();
    
    // 마피아 게임 상태 관리용 Map
    this.mafiaGameStates = new Map();
  }

  // 마피아 게임 초기화
  initializeMafiaGame(roomId, participants) {
    if (participants.length < 3 || participants.length > 5) {
      throw new Error('마피아 게임은 3명 이상 5명 이하에서만 가능합니다.');
    }

    // 마피아 1명 랜덤 선정
    const mafiaIndex = Math.floor(Math.random() * participants.length);
    const mafia = participants[mafiaIndex];
    const citizens = participants.filter((_, index) => index !== mafiaIndex);

    const gameState = {
      roomId,
      participants,
      mafia: mafia.id,
      citizens: citizens.map(c => c.id),
      alive: participants.map(c => c.id),
      phase: 'night', // night, day, voting, end
      day: 1,
      votes: {},
      nightEvents: [],
      isActive: true,
      startTime: new Date(),
      votingResults: []
    };

    this.mafiaGameStates.set(roomId, gameState);
    return gameState;
  }

  // 마피아 게임 상태 가져오기
  getMafiaGameState(roomId) {
    return this.mafiaGameStates.get(roomId);
  }

  // 마피아 게임 종료
  endMafiaGame(roomId) {
    this.mafiaGameStates.delete(roomId);
  }

  // 마피아 게임 명령어 체크
  isMafiaGameCommand(message) {
    const mafiaStartKeywords = ['마피아게임', '마피아', '마피아 게임', '마피아게임시작'];
    return mafiaStartKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  // 투표 명령어 체크
  isVoteCommand(message) {
    const votePattern = /^투표\s+(.+)$/i;
    return votePattern.test(message.trim());
  }

  // 투표 처리
  processVote(gameState, voterId, targetName) {
    // 투표자가 살아있는지 확인
    if (!gameState.alive.includes(voterId)) {
      return { success: false, message: '이미 탈락한 플레이어는 투표할 수 없습니다.' };
    }

    // 투표 대상 찾기
    const target = gameState.participants.find(p => 
      p.name.toLowerCase() === targetName.toLowerCase()
    );

    if (!target) {
      return { success: false, message: '해당 플레이어를 찾을 수 없습니다.' };
    }

    if (!gameState.alive.includes(target.id)) {
      return { success: false, message: '이미 탈락한 플레이어에게는 투표할 수 없습니다.' };
    }

    // 투표 기록
    gameState.votes[voterId] = target.id;

    return { success: true, message: `${target.name}님에게 투표했습니다.` };
  }

  // 투표 결과 집계
  calculateVoteResult(gameState) {
    const voteCount = {};
    const aliveParticipants = gameState.participants.filter(p => 
      gameState.alive.includes(p.id)
    );

    // 투표 집계
    Object.values(gameState.votes).forEach(targetId => {
      voteCount[targetId] = (voteCount[targetId] || 0) + 1;
    });

    // 최다 득표자 찾기
    let maxVotes = 0;
    let eliminated = null;

    Object.entries(voteCount).forEach(([targetId, votes]) => {
      if (votes > maxVotes) {
        maxVotes = votes;
        eliminated = targetId;
      }
    });

    if (eliminated) {
      // 플레이어 제거
      gameState.alive = gameState.alive.filter(id => id !== eliminated);
      gameState.citizens = gameState.citizens.filter(id => id !== eliminated);
      
      const eliminatedPlayer = gameState.participants.find(p => p.id === eliminated);
      const wasMafia = gameState.mafia === eliminated;

      return {
        eliminated: eliminatedPlayer,
        wasMafia,
        voteCount,
        totalVotes: Object.keys(gameState.votes).length
      };
    }

    return null;
  }

  // 게임 승리 조건 체크
  checkWinCondition(gameState) {
    const aliveCitizens = gameState.citizens.filter(id => gameState.alive.includes(id));
    const mafiaAlive = gameState.alive.includes(gameState.mafia);

    if (!mafiaAlive) {
      return { gameEnd: true, winner: 'citizens', message: '🎉 시민 승리! 마피아를 찾아냈습니다!' };
    }

    if (aliveCitizens.length <= 1) {
      return { gameEnd: true, winner: 'mafia', message: '😈 마피아 승리! 마피아가 마을을 장악했습니다!' };
    }

    return { gameEnd: false };
  }

  // 밤 이벤트 생성
  generateNightEvent(gameState) {
    const aliveParticipants = gameState.participants.filter(p => 
      gameState.alive.includes(p.id)
    );
    
    if (aliveParticipants.length === 0) return null;

    const randomPlayer = aliveParticipants[Math.floor(Math.random() * aliveParticipants.length)];
    
    const events = [
      `🌙 ${randomPlayer.name}님의 집에서 이상한 소음이 들렸습니다...`,
      `🔍 ${randomPlayer.name}님이 밤늦게 밖을 돌아다니는 모습이 목격되었습니다.`,
      `💡 ${randomPlayer.name}님의 집에 늦은 시간까지 불이 켜져 있었습니다.`,
      `📞 ${randomPlayer.name}님이 누군가와 수상한 통화를 하는 것을 들었다는 증언이 있습니다.`,
      `🚪 ${randomPlayer.name}님의 집 문이 새벽에 열리고 닫히는 소리가 났습니다.`
    ];

    const selectedEvent = events[Math.floor(Math.random() * events.length)];
    gameState.nightEvents.push(selectedEvent);
    
    return selectedEvent;
  }

  // 마피아 게임 메시지 처리
  async processMafiaGameMessage(message, gameState, userId, callbacks) {
    // 투표 처리
    if (gameState.phase === 'voting' && this.isVoteCommand(message)) {
      const voteMatch = message.match(/^투표\s+(.+)$/i);
      const targetName = voteMatch[1];
      
      const result = this.processVote(gameState, userId, targetName);
      
      if (result.success) {
        // 모든 생존자가 투표했는지 확인
        const aliveCount = gameState.alive.length;
        const voteCount = Object.keys(gameState.votes).length;
        
        if (voteCount >= aliveCount) {
          // 투표 결과 처리
          const voteResult = this.calculateVoteResult(gameState);
          const winCheck = this.checkWinCondition(gameState);
          
          let responseMessage = this.formatVoteResult(voteResult, gameState);
          
          if (winCheck.gameEnd) {
            responseMessage += `\n\n${winCheck.message}`;
            this.endMafiaGame(gameState.roomId);
          } else {
            // 다음 밤으로 진행
            gameState.phase = 'night';
            gameState.day++;
            gameState.votes = {};
            
            const nightEvent = this.generateNightEvent(gameState);
            responseMessage += `\n\n🌙 **${gameState.day}일차 밤이 되었습니다.**\n${nightEvent}`;
            responseMessage += '\n\n아침이 되면 토론을 시작하겠습니다. "토론시작"이라고 말씀해주세요.';
          }
          
          callbacks.onStart();
          callbacks.onComplete({ content: responseMessage });
          return responseMessage;
        } else {
          const remainingVotes = aliveCount - voteCount;
          const responseMessage = `${result.message}\n아직 ${remainingVotes}명이 더 투표해야 합니다.`;
          
          callbacks.onStart();
          callbacks.onComplete({ content: responseMessage });
          return responseMessage;
        }
      } else {
        callbacks.onStart();
        callbacks.onComplete({ content: result.message });
        return result.message;
      }
    }

    // 토론 시작
    if (gameState.phase === 'night' && message.includes('토론시작')) {
      gameState.phase = 'day';
      
      const aliveParticipants = gameState.participants
        .filter(p => gameState.alive.includes(p.id))
        .map(p => p.name)
        .join(', ');
      
      const responseMessage = `☀️ **${gameState.day}일차 낮이 되었습니다.**

**생존자:** ${aliveParticipants}

어젯밤 일어난 일에 대해 토론해주세요. 
의심스러운 사람이 있다면 자유롭게 이야기하세요.

토론이 끝나면 "투표시작"이라고 말씀해주세요.`;

      callbacks.onStart();
      callbacks.onComplete({ content: responseMessage });
      return responseMessage;
    }

    // 투표 시작
    if (gameState.phase === 'day' && message.includes('투표시작')) {
      gameState.phase = 'voting';
      gameState.votes = {};
      
      const aliveParticipants = gameState.participants
        .filter(p => gameState.alive.includes(p.id))
        .map(p => p.name);
      
      const responseMessage = `🗳️ **투표를 시작합니다!**

**투표 방법:** "투표 [이름]" 형식으로 입력해주세요.
**예시:** 투표 홍길동

**생존자 목록:**
${aliveParticipants.map(name => `- ${name}`).join('\n')}

모든 생존자가 투표하면 결과를 발표하겠습니다.`;

      callbacks.onStart();
      callbacks.onComplete({ content: responseMessage });
      return responseMessage;
    }

    return null;
  }

  // 투표 결과 포맷팅
  formatVoteResult(voteResult, gameState) {
    if (!voteResult || !voteResult.eliminated) {
      return '투표 결과를 집계할 수 없습니다.';
    }

    const { eliminated, wasMafia, voteCount } = voteResult;
    
    let message = `📊 **투표 결과**\n\n`;
    
    // 득표 현황
    Object.entries(voteCount).forEach(([targetId, votes]) => {
      const player = gameState.participants.find(p => p.id === targetId);
      message += `${player.name}: ${votes}표\n`;
    });
    
    message += `\n💀 **${eliminated.name}님이 투표로 처형되었습니다.**\n`;
    
    if (wasMafia) {
      message += `🎯 ${eliminated.name}님은 **마피아**였습니다!`;
    } else {
      message += `😇 ${eliminated.name}님은 **시민**이었습니다...`;
    }
    
    return message;
  }

  async generateResponse(message, persona = 'wayneAI', callbacks, userId = null, roomId = null, participants = []) {
    try {
      // 마피아 게임 상태 확인
      const mafiaGameState = roomId ? this.getMafiaGameState(roomId) : null;
      
      // 마피아 게임 진행 중인 메시지 처리
      if (mafiaGameState && mafiaGameState.isActive) {
        const mafiaResponse = await this.processMafiaGameMessage(message, mafiaGameState, userId, callbacks);
        if (mafiaResponse) {
          return mafiaResponse; // 문자열 반환
        }
      }
      
      // 마피아 게임 시작 명령어 체크
      if (this.isMafiaGameCommand(message)) {
        if (participants.length < 3 || participants.length > 5) {
          const errorMessage = `마피아 게임은 3명 이상 5명 이하에서만 가능합니다.\n현재 참여자: ${participants.length}명`;
          callbacks.onStart();
          callbacks.onComplete({ content: errorMessage }); // 객체로 전달
          return errorMessage;
        }

        const gameState = this.initializeMafiaGame(roomId, participants);
        const nightEvent = this.generateNightEvent(gameState);
        
        const startMessage = `🕵️ **마피아 게임을 시작합니다!**

**참여자:** ${participants.map(p => p.name).join(', ')}
**규칙:**
- 마피아 1명 vs 시민 ${participants.length - 1}명
- 밤에는 의심스러운 상황이 벌어집니다
- 낮에는 토론 후 투표로 마피아를 찾아내세요
- 시민 2명이 남을 때까지 게임이 진행됩니다

🌙 **1일차 밤이 시작되었습니다.**
${nightEvent}

각자의 역할이 개인 메시지로 전달됩니다.
아침이 되면 토론을 시작하겠습니다. "토론시작"이라고 말씀해주세요.`;

        callbacks.onStart();
        callbacks.onComplete({ content: startMessage }); // 객체로 전달
        return { content: startMessage, gameState, sendPrivateMessages: true }; // 객체 반환 (특별한 경우)
      }

      // 기존 업다운 게임 로직
      const gameState = userId && roomId ? this.getGameState(userId, roomId) : null;
      
      if (this.isGameCommand(message)) {
        const gameId = this.initializeGame(userId, roomId);
        const startMessage = `🎮 **업다운 게임을 시작합니다!**

1부터 100까지의 숫자 중 하나를 정했습니다.
숫자를 맞춰보세요!

- 숫자가 낮으면 "UP" 이라고 알려드립니다
- 숫자가 높으면 "DOWN" 이라고 알려드립니다
- 게임 중에는 @호출 없이 숫자만 입력하시면 됩니다

첫 번째 숫자를 입력해주세요! 🎯`;

        callbacks.onStart();
        callbacks.onComplete({ content: startMessage }); // 객체로 전달
        return startMessage;
      }

      if (gameState && gameState.isActive && this.isNumberGuess(message)) {
        const guess = parseInt(message.trim());
        const result = this.processGameGuess(gameState, guess);
        
        if (result.isGameEnd) {
          this.endGame(userId, roomId);
        }
        
        callbacks.onStart();
        callbacks.onComplete({ content: result.message }); // 객체로 전달
        return result.message;
      }

      // 일반 AI 응답 처리 (기존 로직)
      const aiPersona = {
        wayneAI: {
          name: 'Wayne AI',
          role: '친절하고 도움이 되는 어시스턴트',
          traits: '전문적이고 통찰력 있는 답변을 제공하며, 사용자의 질문을 깊이 이해하고 명확한 설명을 제공합니다.',
          tone: '전문적이면서도 친근한 톤',
        },
        consultingAI: {
          name: 'Consulting AI',
          role: '비즈니스 컨설팅 전문가',
          traits: '비즈니스 전략, 시장 분석, 조직 관리에 대한 전문적인 조언을 제공합니다.',
          tone: '전문적이고 분석적인 톤',
        }
      }[persona];

      if (!aiPersona) {
        throw new Error('Unknown AI persona');
      }

      const systemPrompt = `당신은 ${aiPersona.name}입니다.
역할: ${aiPersona.role}
특성: ${aiPersona.traits}
톤: ${aiPersona.tone}

답변 시 주의사항:
1. 명확하고 이해하기 쉬운 언어로 답변하세요.
2. 정확하지 않은 정보는 제공하지 마세요.
3. 필요한 경우 예시를 들어 설명하세요.
4. ${aiPersona.tone}을 유지하세요.

게임 기능:
- "업다운", "업다운게임", "숫자맞추기", "게임시작" -> 업다운 게임
- "마피아", "마피아게임", "마피아 게임" -> 마피아 게임 (3-5명)`;

      callbacks.onStart();

      const response = await this.openaiClient.post('/chat/completions', {
        model: 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        temperature: 0.7,
        stream: true
      }, {
        responseType: 'stream'
      });

      let fullResponse = '';
      let isCodeBlock = false;
      let buffer = '';

      return new Promise((resolve, reject) => {
        response.data.on('data', async chunk => {
          try {
            buffer += chunk.toString();

            while (true) {
              const newlineIndex = buffer.indexOf('\n');
              if (newlineIndex === -1) break;

              const line = buffer.slice(0, newlineIndex).trim();
              buffer = buffer.slice(newlineIndex + 1);

              if (line === '') continue;
              if (line === 'data: [DONE]') {
                // 수정: 객체로 전달
                callbacks.onComplete({ content: fullResponse.trim() });
                resolve(fullResponse.trim());
                return;
              }

              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  const content = data.choices[0]?.delta?.content;
                  
                  if (content) {
                    if (content.includes('```')) {
                      isCodeBlock = !isCodeBlock;
                    }

                    await callbacks.onChunk({
                      currentChunk: content,
                      isCodeBlock
                    });

                    fullResponse += content;
                  }
                } catch (err) {
                  console.error('JSON parsing error:', err);
                }
              }
            }
          } catch (error) {
            console.error('Stream processing error:', error);
            callbacks.onError(error);
            reject(error);
          }
        });

        response.data.on('error', error => {
          console.error('Stream error:', error);
          callbacks.onError(error);
          reject(error);
        });
      });

    } catch (error) {
      console.error('AI response generation error:', error);
      callbacks.onError(error);
      throw new Error('AI 응답 생성 중 오류가 발생했습니다.');
    }
  }

  // 기존 업다운 게임 메서드들은 그대로 유지...
  initializeGame(userId, roomId) {
    const gameId = `${userId}-${roomId}`;
    const targetNumber = Math.floor(Math.random() * 100) + 1;
    
    this.gameStates.set(gameId, {
      targetNumber,
      attempts: 0,
      isActive: true,
      startTime: new Date(),
      lastGuess: null
    });
    
    return gameId;
  }

  getGameState(userId, roomId) {
    const gameId = `${userId}-${roomId}`;
    return this.gameStates.get(gameId);
  }

  endGame(userId, roomId) {
    const gameId = `${userId}-${roomId}`;
    this.gameStates.delete(gameId);
  }

  isGameCommand(message) {
    const gameStartKeywords = ['업다운', '업다운게임', '숫자맞추기', '게임시작'];
    return gameStartKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  isNumberGuess(message) {
    const trimmed = message.trim();
    const number = parseInt(trimmed);
    return !isNaN(number) && number >= 1 && number <= 100 && trimmed === number.toString();
  }

  processGameGuess(gameState, guess) {
    gameState.attempts++;
    gameState.lastGuess = guess;
    
    if (guess === gameState.targetNumber) {
      return {
        type: 'win',
        message: `🎉 정답입니다! ${guess}가 맞습니다!\n${gameState.attempts}번 만에 맞추셨네요! 정말 대단해요!\n\n새로운 게임을 하시려면 "업다운 게임 시작"이라고 말씀해주세요.`,
        isGameEnd: true
      };
    } else if (guess < gameState.targetNumber) {
      return {
        type: 'up',
        message: `⬆️ **UP!** \n${guess}보다 큰 숫자입니다.\n현재 시도 횟수: ${gameState.attempts}회`,
        isGameEnd: false
      };
    } else {
      return {
        type: 'down', 
        message: `⬇️ **DOWN!** \n${guess}보다 작은 숫자입니다.\n현재 시도 횟수: ${gameState.attempts}회`,
        isGameEnd: false
      };
    }
  }
}

module.exports = AIService;