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
    
    // 게임 상태 관리용 Map
    this.gameStates = new Map();
  }

  // 게임 상태 초기화
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

  // 게임 상태 가져오기
  getGameState(userId, roomId) {
    const gameId = `${userId}-${roomId}`;
    return this.gameStates.get(gameId);
  }

  // 게임 종료
  endGame(userId, roomId) {
    const gameId = `${userId}-${roomId}`;
    this.gameStates.delete(gameId);
  }

  // 게임 명령어 체크
  isGameCommand(message) {
    const gameStartKeywords = ['업다운', '업다운게임', '숫자맞추기', '게임시작'];
    return gameStartKeywords.some(keyword => 
      message.toLowerCase().includes(keyword.toLowerCase())
    );
  }

  // 숫자 입력 체크
  isNumberGuess(message) {
    const trimmed = message.trim();
    const number = parseInt(trimmed);
    return !isNaN(number) && number >= 1 && number <= 100 && trimmed === number.toString();
  }

  // 업다운 게임 로직 처리
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

  async generateResponse(message, persona = 'wayneAI', callbacks, userId = null, roomId = null) {
    try {
      // 게임 상태 확인
      const gameState = userId && roomId ? this.getGameState(userId, roomId) : null;
      
      // 게임 시작 명령어 체크
      if (this.isGameCommand(message)) {
        const gameId = this.initializeGame(userId, roomId);
        const startMessage = `🎮 **업다운 게임을 시작합니다!**

1부터 100까지의 숫자 중 하나를 정했습니다.
숫자를 맞춰보세요!

- 숫자가 낮으면 "UP" 이라고 알려드립니다
- 숫자가 높으면 "DOWN" 이라고 알려드립니다
- 게임 중에는 @호출 없이 숫자만 입력하시면 됩니다

첫 번째 숫자를 입력해주세요! 🎯`;

        // 즉시 응답 반환 (스트리밍 없이)
        callbacks.onStart();
        callbacks.onComplete({ content: startMessage });
        return startMessage;
      }

      // 게임 진행 중 숫자 입력 체크  
      if (gameState && gameState.isActive && this.isNumberGuess(message)) {
        const guess = parseInt(message.trim());
        const result = this.processGameGuess(gameState, guess);
        
        if (result.isGameEnd) {
          this.endGame(userId, roomId);
        }
        
        // 즉시 응답 반환 (스트리밍 없이)
        callbacks.onStart();
        callbacks.onComplete({ content: result.message });
        return result.message;
      }

      // 일반 AI 응답 처리
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
- 사용자가 "업다운", "업다운게임", "숫자맞추기", "게임시작" 등의 키워드를 사용하면 업다운 게임을 안내해주세요.`;

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
                callbacks.onComplete({
                  content: fullResponse.trim()
                });
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
}

module.exports = new AIService();