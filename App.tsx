import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';

// --- 타입 정의 ---
type GameState = 'startScreen' | 'playing' | 'paused' | 'upgrade' | 'gameOver';
type AnimationState = 'attacking' | 'hit' | null;

interface CharacterStats {
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  attackInterval: number;
  isEmpowered?: boolean;
}

interface DamageInfo {
  value: number;
  isSkill: boolean;
  isUltimate?: boolean;
}

interface Buffs {
  defense: number;
  attackIntervalMultiplier: number;
}

interface MonsterDebuffs {
  defenseReduction: number; // 0 to 1
}

interface Skill {
  id: string;
  name: string;
  description: string;
  cooldown: number;
  effect: (actions: SkillActions) => void;
}

interface SkillActions {
  setPlayerStats: React.Dispatch<React.SetStateAction<CharacterStats>>;
  setMonsterStats: React.Dispatch<React.SetStateAction<CharacterStats>>;
  setDamageDealt: React.Dispatch<React.SetStateAction<DamageInfo | null>>;
  setScreenShake: React.Dispatch<React.SetStateAction<boolean>>;
  setBuffs: React.Dispatch<React.SetStateAction<Buffs>>;
  setMonsterDebuffs: React.Dispatch<React.SetStateAction<MonsterDebuffs>>;
  playerStats: CharacterStats;
  monsterStats: CharacterStats;
  playerStatsRef: React.RefObject<CharacterStats>;
}


// --- 초기값 및 상수 ---
const initialPlayerStats: CharacterStats = {
  hp: 100,
  maxHp: 100,
  attack: 5,
  defense: 1,
  attackInterval: 500,
};

const ULTIMATE_SKILL_COOLDOWN = 50;
const SPECIAL_STAGE_CHANCE = 0.2; // 20%
const MAX_SKILLS = 4;

const calculateDamage = (attack: number, defense: number): number => {
  return Math.max(1, attack - defense);
};

const ALL_SKILLS: Skill[] = [
  {
    id: 'smite',
    name: '강타',
    description: '공격력의 5배에 해당하는 강력한 피해를 줍니다.',
    cooldown: 8,
    effect: ({ playerStats, monsterStats, setMonsterStats, setDamageDealt, setScreenShake }) => {
      const damage = calculateDamage(playerStats.attack * 5, monsterStats.defense);
      setMonsterStats(prev => ({ ...prev, hp: Math.max(0, prev.hp - damage) }));
      setDamageDealt({ value: damage, isSkill: true });
      setTimeout(() => setDamageDealt(null), 800);
      setScreenShake(true);
      setTimeout(() => setScreenShake(false), 400);
    }
  },
  {
    id: 'healing_touch',
    name: '치유의 손길',
    description: '최대 체력의 25%를 즉시 회복합니다.',
    cooldown: 20,
    effect: ({ setPlayerStats }) => {
      setPlayerStats(prev => ({ ...prev, hp: Math.min(prev.maxHp, prev.hp + prev.maxHp * 0.25) }));
    }
  },
  {
    id: 'stone_skin',
    name: '돌가죽',
    description: '5초 동안 방어력이 10 증가합니다.',
    cooldown: 18,
    effect: ({ setBuffs }) => {
      setBuffs(prev => ({ ...prev, defense: 10 }));
      setTimeout(() => {
        setBuffs(prev => ({ ...prev, defense: 0 }));
      }, 5000);
    }
  },
    {
    id: 'frenzy',
    name: '광란',
    description: '5초 동안 공격 속도가 2배 빨라집니다.',
    cooldown: 18,
    effect: ({ setBuffs }) => {
      setBuffs(prev => ({ ...prev, attackIntervalMultiplier: 0.5 }));
      setTimeout(() => {
        setBuffs(prev => ({ ...prev, attackIntervalMultiplier: 1 }));
      }, 5000);
    }
  },
  {
    id: 'chain_lightning',
    name: '연쇄 번개',
    description: '적에게 3번의 약한 번개 피해를 입힙니다.',
    cooldown: 12,
    effect: ({ playerStatsRef, setMonsterStats, setDamageDealt }) => {
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          setMonsterStats(prev => {
            if (prev.hp <= 0) return prev;
            const damage = calculateDamage(playerStatsRef.current!.attack, prev.defense);
            setDamageDealt({ value: damage, isSkill: true });
            setTimeout(() => setDamageDealt(null), 800);
            return { ...prev, hp: Math.max(0, prev.hp - damage) };
          });
        }, i * 200);
      }
    }
  },
  {
    id: 'armor_break',
    name: '방어구 부수기',
    description: '10초 동안 적의 방어력을 50% 감소시킵니다.',
    cooldown: 20,
    effect: ({ setMonsterDebuffs }) => {
      setMonsterDebuffs({ defenseReduction: 0.5 });
      setTimeout(() => {
        setMonsterDebuffs({ defenseReduction: 0 });
      }, 10000);
    }
  },
];


// --- 헬퍼 함수 및 컴포넌트 ---
const HealthBar: React.FC<{ current: number; max: number }> = ({ current, max }) => {
  const percentage = max > 0 ? (current / max) * 100 : 0;
  return (
    <div className="w-full bg-gray-600 rounded-full h-6 overflow-hidden border-2 border-gray-500">
      <div
        className="bg-red-500 h-full transition-all duration-300 ease-in-out"
        style={{ width: `${percentage}%` }}
      ></div>
    </div>
  );
};

const DamageText: React.FC<{ damage: number; isPlayer: boolean; isSkill?: boolean; isUltimate?: boolean }> = ({ damage, isPlayer, isSkill, isUltimate }) => (
    <div className={`absolute top-0 left-1/2 -translate-x-1/2 font-bold animate-fade-in-down pointer-events-none ${isUltimate ? 'text-orange-400 text-8xl' : isSkill ? 'text-purple-400 text-7xl' : (isPlayer ? 'text-yellow-300 text-5xl' : 'text-red-500 text-5xl')}`} style={{ textShadow: '2px 2px #000' }}>
      -{damage}
    </div>
);

const generateMonster = (stage: number, numPlayerSkills: number): CharacterStats => {
  const isBoss = stage > 0 && stage % 5 === 0;
  const stageMultiplier = 1 + (stage - 1) * 0.3;

  const isEmpowered = numPlayerSkills === MAX_SKILLS;
  const fullSkillSetMultiplier = isEmpowered ? 1.5 : 1;

  const baseHp = 80;
  const baseAttack = 6;
  const baseDefense = 3;

  const bossHpMultiplier = 2.2;
  const bossAttackMultiplier = 1.5;
  const bossDefenseMultiplier = 1.2;

  const hp = Math.floor(baseHp * stageMultiplier * (isBoss ? bossHpMultiplier : 1) * fullSkillSetMultiplier);
  const attack = Math.floor(baseAttack * stageMultiplier * (isBoss ? bossAttackMultiplier : 1) * fullSkillSetMultiplier);
  let defense = Math.floor(baseDefense * stageMultiplier * (isBoss ? bossDefenseMultiplier : 1) * fullSkillSetMultiplier);

  // 10 스테이지부터 몬스터가 너무 쉽게 죽는 것을 방지하기 위해 방어력을 추가로 증가시킵니다.
  if (stage >= 10) {
    const extraDefense = Math.floor(Math.pow(stage - 9, 1.5));
    defense += extraDefense;
  }

  return {
    hp: hp,
    maxHp: hp,
    attack: attack,
    defense: defense,
    attackInterval: 2500, // 2.5초로 조정
    isEmpowered: isEmpowered,
  };
};

const generateTreasureGoblin = (): CharacterStats => ({
  hp: 50,
  maxHp: 50,
  attack: 0,
  defense: 50,
  attackInterval: 10000, // Escape time
});

function App() {
  const [gameState, setGameState] = useState<GameState>('startScreen');
  const [playerStats, setPlayerStats] = useState<CharacterStats>(initialPlayerStats);
  const [stage, setStage] = useState(1);
  const [playerSkills, setPlayerSkills] = useState<Skill[]>([]);
  const [monsterStats, setMonsterStats] = useState<CharacterStats>(generateMonster(stage, playerSkills.length));
  const [upgradePoints, setUpgradePoints] = useState(0);
  const [damageDealt, setDamageDealt] = useState<DamageInfo | null>(null);
  const [damageTaken, setDamageTaken] = useState<number | null>(null);
  const [playerAnimation, setPlayerAnimation] = useState<AnimationState>(null);
  const [monsterAnimation, setMonsterAnimation] = useState<AnimationState>(null);
  const [screenShake, setScreenShake] = useState(false);
  const [lastReward, setLastReward] = useState(1);

  const [skillCooldowns, setSkillCooldowns] = useState<{ [key: string]: number }>({});
  const [skillChoices, setSkillChoices] = useState<Skill[]>([]);
  const [showSkillChoice, setShowSkillChoice] = useState(false);
  const [isReplacingSkill, setIsReplacingSkill] = useState(false);
  const [skillToLearn, setSkillToLearn] = useState<Skill | null>(null);
  
  const [buffs, setBuffs] = useState<Buffs>({ defense: 0, attackIntervalMultiplier: 1 });
  const [monsterDebuffs, setMonsterDebuffs] = useState<MonsterDebuffs>({ defenseReduction: 0 });

  const [isAutoAttack, setIsAutoAttack] = useState(true);
  const [ultimateSkillCooldown, setUltimateSkillCooldown] = useState(0);
  const [isSpecialStage, setIsSpecialStage] = useState(false);
  const [isBossStage, setIsBossStage] = useState(false);
  const [specialStageTimer, setSpecialStageTimer] = useState(0);

  const [coins, setCoins] = useState(0);
  const [gachaResult, setGachaResult] = useState<string | null>(null);
  const [lastCoinReward, setLastCoinReward] = useState(0);

  const playerStatsRef = useRef(playerStats);
  useEffect(() => { playerStatsRef.current = playerStats; });
  const monsterStatsRef = useRef(monsterStats);
  useEffect(() => { monsterStatsRef.current = monsterStats; });
  const lastAttackTime = useRef(0);
  const playerSkillsRef = useRef(playerSkills);
  useEffect(() => { playerSkillsRef.current = playerSkills; });

  const effectivePlayerStats = useMemo(() => ({
    ...playerStats,
    defense: playerStats.defense + buffs.defense,
    attackInterval: playerStats.attackInterval * buffs.attackIntervalMultiplier,
  }), [playerStats, buffs]);
    
  const effectivePlayerStatsRef = useRef(effectivePlayerStats);
  useEffect(() => { effectivePlayerStatsRef.current = effectivePlayerStats; });
  
  const effectiveMonsterStats = useMemo(() => ({
    ...monsterStats,
    defense: Math.max(0, Math.floor(monsterStats.defense * (1 - monsterDebuffs.defenseReduction))),
  }), [monsterStats, monsterDebuffs]);
    
  const effectiveMonsterStatsRef = useRef(effectiveMonsterStats);
  useEffect(() => { effectiveMonsterStatsRef.current = effectiveMonsterStats; });


  const generateSkillChoices = useCallback(() => {
    const currentSkillIds = playerSkillsRef.current.map(s => s.id);
    const availableSkills = ALL_SKILLS.filter(s => !currentSkillIds.includes(s.id));
    const shuffled = [...availableSkills].sort(() => 0.5 - Math.random());
    setSkillChoices(shuffled.slice(0, 3));
  }, []);
  
  useEffect(() => {
    if (gameState === 'upgrade' && showSkillChoice && !isReplacingSkill) {
      generateSkillChoices();
    }
  }, [gameState, showSkillChoice, isReplacingSkill, generateSkillChoices]);

  const handleStartGame = () => setGameState('playing');
  const handlePauseResume = () => {
    if (gameState === 'playing') setGameState('paused');
    else if (gameState === 'paused') setGameState('playing');
  };

  const handleNextStage = () => {
    const nextStageNumber = isSpecialStage ? stage : stage + 1;

    const isNextBossStage = nextStageNumber > 0 && nextStageNumber % 5 === 0;
    const canBeSpecialStage = !isNextBossStage;
    const isNextSpecialStage = canBeSpecialStage && Math.random() < SPECIAL_STAGE_CHANCE;

    setIsBossStage(isNextBossStage);
    setIsSpecialStage(isNextSpecialStage);

    if (isNextSpecialStage) {
        setMonsterStats(generateTreasureGoblin());
    } else {
        setStage(nextStageNumber);
        setMonsterStats(generateMonster(nextStageNumber, playerSkills.length));
    }
    
    setPlayerStats(prev => ({ ...prev, hp: prev.maxHp }));
    setSkillCooldowns({});
    setShowSkillChoice(false);
    setGameState('playing');
    setSkillChoices([]);
    setGachaResult(null);
  };

  const handleRestart = () => {
    setPlayerStats(initialPlayerStats);
    setStage(1);
    setMonsterStats(generateMonster(1, 0));
    setUpgradePoints(0);
    setCoins(0);
    setLastCoinReward(0);
    setGachaResult(null);
    setPlayerSkills([]);
    setSkillCooldowns({});
    setUltimateSkillCooldown(0);
    setBuffs({ defense: 0, attackIntervalMultiplier: 1 });
    setMonsterDebuffs({ defenseReduction: 0 });
    setIsAutoAttack(true);
    setIsSpecialStage(false);
    setIsBossStage(false);
    setShowSkillChoice(false);
    setGameState('startScreen');
  };
  
  useEffect(() => {
    if (monsterStats.hp <= 0 && gameState === 'playing') {
      const clearedStageIsBoss = stage > 0 && stage % 5 === 0;
      const reward = isSpecialStage ? 3 : (clearedStageIsBoss ? 5 : 1);
      setLastReward(reward);
      setUpgradePoints(prev => prev + reward);
      
      const baseCoinReward = 20 + (stage - 1) * 2;
      const coinReward = isSpecialStage ? baseCoinReward * 3 : (clearedStageIsBoss ? baseCoinReward * 5 : baseCoinReward);
      setLastCoinReward(coinReward);
      setCoins(prev => prev + coinReward);

      const canChooseSkill = !isSpecialStage;
      if (canChooseSkill) {
          setShowSkillChoice(true);
      }

      setIsSpecialStage(false); // 리셋
      setIsBossStage(false); // 리셋
      setGameState('upgrade');
    }
  }, [monsterStats.hp, gameState, isSpecialStage, stage]);

// 스킬 쿨타임
  useEffect(() => {
    if (gameState !== 'playing') return;

    const timer = setInterval(() => {
      setSkillCooldowns(prevCooldowns => {
        const newCooldowns = { ...prevCooldowns };
        let changed = false;
        for (const skillId in newCooldowns) {
          if (newCooldowns[skillId] > 0) {
            newCooldowns[skillId] = Math.max(0, newCooldowns[skillId] - 0.1);
            changed = true;
          }
        }
        return changed ? newCooldowns : prevCooldowns;
      });
    }, 100);

    return () => clearInterval(timer);
  }, [gameState]);

  // 궁극기 쿨타임
  useEffect(() => {
      if (ultimateSkillCooldown > 0) {
          const timer = setTimeout(() => {
              setUltimateSkillCooldown(prev => Math.max(0, prev - 0.1));
          }, 100);
          return () => clearTimeout(timer);
      }
  }, [ultimateSkillCooldown]);

  // 특수 스테이지 타이머
  useEffect(() => {
    if (gameState === 'playing' && isSpecialStage) {
      setSpecialStageTimer(monsterStats.attackInterval / 1000);
      const interval = setInterval(() => {
        setSpecialStageTimer(prev => {
          if (prev <= 0.1) {
            clearInterval(interval);
            setGameState('upgrade'); // 시간 다 되면 도망
            setIsSpecialStage(false);
            setLastReward(0);
            setLastCoinReward(0);
            return 0;
          }
          return prev - 0.1;
        });
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gameState, isSpecialStage, monsterStats.attackInterval]);

  const handleUpgrade = (stat: keyof CharacterStats) => {
    if (upgradePoints > 0) {
      setPlayerStats(prev => {
        const newStats = { ...prev };
        if (stat === 'maxHp') {
          newStats.maxHp += 10;
          newStats.hp = newStats.maxHp;
        } else if (stat === 'attack') {
          newStats.attack += 2;
        } else if (stat === 'defense') {
          newStats.defense += 1;
        } else if (stat === 'attackInterval' && newStats.attackInterval > 100) {
          newStats.attackInterval = Math.max(100, newStats.attackInterval - 50);
        }
        return newStats;
      });
      setUpgradePoints(prev => prev - 1);
    }
  };

  const handleGachaPull = () => {
    if (coins < 50) return;
    setCoins(prev => prev - 50);

    const roll = Math.random() * 100;
    let resultMessage = '';
    
    if (roll < 30) { // Common: Stat +1
      const statRoll = Math.floor(Math.random() * 3);
      if (statRoll === 0) {
        setPlayerStats(prev => ({ ...prev, attack: prev.attack + 1 }));
        resultMessage = "소소한 힘: 공격력 +1";
      } else if (statRoll === 1) {
        setPlayerStats(prev => ({ ...prev, defense: prev.defense + 1 }));
        resultMessage = "소소한 맷집: 방어력 +1";
      } else {
        setPlayerStats(prev => ({ ...prev, maxHp: prev.maxHp + 5, hp: prev.hp + 5 }));
        resultMessage = "소소한 활력: 최대 체력 +5";
      }
    } else if (roll < 60) { // Common: Stat +2
        const statRoll = Math.floor(Math.random() * 3);
      if (statRoll === 0) {
        setPlayerStats(prev => ({ ...prev, attack: prev.attack + 2 }));
        resultMessage = "준수한 힘: 공격력 +2";
      } else if (statRoll === 1) {
        setPlayerStats(prev => ({ ...prev, defense: prev.defense + 2 }));
        resultMessage = "준수한 맷집: 방어력 +2";
      } else {
        setPlayerStats(prev => ({ ...prev, maxHp: prev.maxHp + 10, hp: prev.hp + 10 }));
        resultMessage = "준수한 활력: 최대 체력 +10";
      }
    } else if (roll < 80) { // Uncommon: Attack Speed
      setPlayerStats(prev => ({...prev, attackInterval: Math.max(100, prev.attackInterval - 25)}));
      resultMessage = "날카로운 감각: 공격 속도 증가!";
    } else if (roll < 95) { // Rare: Big Stat Boost
      const statRoll = Math.floor(Math.random() * 3);
      if (statRoll === 0) {
        setPlayerStats(prev => ({ ...prev, attack: prev.attack + 5 }));
        resultMessage = "✨ 강력한 힘: 공격력 +5!";
      } else if (statRoll === 1) {
        setPlayerStats(prev => ({ ...prev, defense: prev.defense + 5 }));
        resultMessage = "✨ 견고한 맷집: 방어력 +5!";
      } else {
        setPlayerStats(prev => ({ ...prev, maxHp: prev.maxHp + 25, hp: prev.maxHp + 25 }));
        resultMessage = "✨ 넘치는 활력: 최대 체력 +25!";
      }
    } else { // Jackpot
      setCoins(prev => prev + 150);
      resultMessage = "💰 대박! 150 코인을 획득했습니다!";
    }

    setGachaResult(resultMessage);
  };

  const handleSelectSkill = (skill: Skill) => {
    if (playerSkills.length < MAX_SKILLS) {
      setPlayerSkills(prev => [...prev, skill]);
      setShowSkillChoice(false);
      setSkillChoices([]);
    } else {
      setSkillToLearn(skill);
      setIsReplacingSkill(true);
      setSkillChoices([]);
    }
  };

  const handleReplaceSkill = (indexToReplace: number) => {
    if (!skillToLearn) return;
    setPlayerSkills(prevSkills => {
      const newSkills = [...prevSkills];
      newSkills[indexToReplace] = skillToLearn;
      return newSkills;
    });
    setSkillToLearn(null);
    setIsReplacingSkill(false);
    setShowSkillChoice(false);
  };

  const handleCancelReplace = () => {
    setSkillToLearn(null);
    setIsReplacingSkill(false);
    generateSkillChoices();
  };
  
  const handleUseSkill = useCallback((skill: Skill) => {
    if (!skill || (skillCooldowns[skill.id] || 0) > 0 || monsterStats.hp <= 0 || playerStats.hp <= 0) return;

    const skillActions: SkillActions = {
      setPlayerStats, setMonsterStats, setDamageDealt, setScreenShake, setBuffs, setMonsterDebuffs,
      playerStats: effectivePlayerStats, 
      monsterStats: effectiveMonsterStats,
      playerStatsRef: effectivePlayerStatsRef,
    };

    skill.effect(skillActions);
    setPlayerAnimation('attacking');
    setTimeout(() => setPlayerAnimation(null), 300);
    setSkillCooldowns(prev => ({ ...prev, [skill.id]: skill.cooldown }));
  }, [skillCooldowns, playerStats.hp, monsterStats.hp, effectivePlayerStats, effectiveMonsterStats]);

  const handleUseUltimateSkill = useCallback(() => {
    if (ultimateSkillCooldown > 0 || monsterStats.hp <= 0 || playerStats.hp <= 0) return;
    const damage = calculateDamage(effectivePlayerStats.attack * 15, effectiveMonsterStats.defense);
    setMonsterStats(prev => ({...prev, hp: Math.max(0, prev.hp - damage)}));
    setDamageDealt({ value: damage, isSkill: true, isUltimate: true});
    setTimeout(() => setDamageDealt(null), 800);
    setScreenShake(true);
    setTimeout(() => setScreenShake(false), 500);
    setPlayerAnimation('attacking');
    setTimeout(() => setPlayerAnimation(null), 300);
    setUltimateSkillCooldown(ULTIMATE_SKILL_COOLDOWN);
  }, [ultimateSkillCooldown, playerStats.hp, monsterStats.hp, effectivePlayerStats, effectiveMonsterStats]);

  const performManualAttack = useCallback(() => {
    const now = Date.now();
    if (now - lastAttackTime.current < effectivePlayerStatsRef.current.attackInterval) return;
    
    lastAttackTime.current = now;
    const damage = calculateDamage(effectivePlayerStatsRef.current.attack, effectiveMonsterStatsRef.current.defense);
    setPlayerAnimation('attacking');
    setMonsterAnimation('hit');
    setTimeout(() => { setPlayerAnimation(null); setMonsterAnimation(null); }, 300);
    setMonsterStats(prev => ({ ...prev, hp: Math.max(0, prev.hp - damage) }));
    setDamageDealt({ value: damage, isSkill: false });
    setTimeout(() => setDamageDealt(null), 500);
  }, []);

  const performMonsterAttack = useCallback(() => {
    if (playerStatsRef.current.hp <= 0 || monsterStatsRef.current.hp <= 0) {
      return;
    }

    setMonsterAnimation('attacking');
    setPlayerAnimation('hit');
    setTimeout(() => { setMonsterAnimation(null); setPlayerAnimation(null); }, 400);

    const damage = calculateDamage(monsterStatsRef.current.attack, effectivePlayerStatsRef.current.defense);
    setDamageTaken(damage);
    setTimeout(() => setDamageTaken(null), 500);

    setPlayerStats(prev => {
      const newHp = Math.max(0, prev.hp - damage);
      if (newHp === 0) {
        setGameState('gameOver');
      }
      return { ...prev, hp: newHp };
    });
  }, []);

  // Player auto-attack
  useEffect(() => {
    if (gameState !== 'playing' || !isAutoAttack || monsterStats.hp <= 0 || playerStats.hp <= 0) return;

    const intervalId = setInterval(() => {
        if (monsterStatsRef.current.hp <= 0 || playerStatsRef.current.hp <= 0) return;
        performManualAttack();
    }, effectivePlayerStats.attackInterval);

    return () => clearInterval(intervalId);
  }, [gameState, isAutoAttack, effectivePlayerStats.attackInterval, performManualAttack]);

// Monster auto-attack
  useEffect(() => {
    if (gameState !== 'playing' || monsterStats.hp <= 0 || isSpecialStage) return;

    const intervalId = setInterval(performMonsterAttack, monsterStats.attackInterval);

    return () => clearInterval(intervalId);
  }, [gameState, stage, isSpecialStage, monsterStats.attackInterval, performMonsterAttack]);

  const renderGameContent = () => {
    switch(gameState) {
      case 'startScreen':
        return (
          <div className="text-center p-8 bg-gray-800 rounded-lg shadow-lg animate-fade-in">
            <h1 className="text-5xl font-bold mb-4">Gemini Infinite Dungeon</h1>
            <p className="text-xl mb-8">몬스터를 처치하고, 강해져서 더 높은 스테이지에 도전하세요!</p>
            <button onClick={handleStartGame} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-10 rounded-lg text-2xl transition-colors">
              게임 시작
            </button>
          </div>
        );
      case 'playing':
      case 'paused':
        const getMonsterBaseName = () => {
            if (isBossStage) return '보스 몬스터';
            if (isSpecialStage) return '보물 고블린';
            return '몬스터';
        }
        const monsterName = monsterStats.isEmpowered && !isSpecialStage ? `흉포한 ${getMonsterBaseName()}` : getMonsterBaseName();

        return (
          <div className="w-full max-w-5xl animate-fade-in relative">
            {gameState === 'paused' && (
               <div className="absolute inset-0 bg-black bg-opacity-70 flex flex-col justify-center items-center z-10 rounded-lg">
                 <h2 className="text-5xl font-bold mb-8">일시정지</h2>
                 <button onClick={handlePauseResume} className="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-lg text-xl">계속하기</button>
               </div>
            )}
            <div className="flex w-full justify-around items-start">
              <div className="w-1/3 p-4 bg-gray-800 rounded-lg shadow-lg text-center flex flex-col h-full">
                <h2 className="text-2xl font-bold mb-4">플레이어</h2>
                <div className="relative h-40 flex justify-center items-center">
                  <div className={`text-8xl transition-transform duration-200 ${playerAnimation === 'attacking' ? 'animate-attack-lunge' : ''} ${playerAnimation === 'hit' ? 'animate-flash-red' : ''}`}>
                    🤺
                  </div>
                  {damageTaken && <DamageText damage={damageTaken} isPlayer={false} />}
                </div>
                <div className="mt-auto space-y-2">
                  <HealthBar current={playerStats.hp} max={playerStats.maxHp} />
                  <p className="mt-2 text-lg">체력: {playerStats.hp} / {playerStats.maxHp}</p>
                  <p>공격력: {effectivePlayerStats.attack}</p>
                  <p>방어력: {effectivePlayerStats.defense} {buffs.defense > 0 && <span className="text-blue-400">(+{buffs.defense})</span>}</p>
                  <p>공격 속도: {(1000 / effectivePlayerStats.attackInterval).toFixed(2)}회/초 {buffs.attackIntervalMultiplier < 1 && <span className="text-yellow-400">(x{1/buffs.attackIntervalMultiplier})</span>}</p>
                  <div className="pt-2">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        {playerSkills.map(skill => {
                            const cooldown = skillCooldowns[skill.id] || 0;
                            return (
                                <button
                                    key={skill.id}
                                    onClick={(e) => { e.stopPropagation(); handleUseSkill(skill); }}
                                    disabled={cooldown > 0}
                                    className={`w-full font-bold py-2 px-2 rounded-lg transition-all duration-200 text-sm shadow-lg ${cooldown > 0 ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 text-white transform hover:scale-105'}`}
                                    title={skill.description}
                                >
                                    {cooldown > 0 ? `${skill.name} (${cooldown.toFixed(1)}s)` : skill.name}
                                </button>
                            );
                        })}
                    </div>
                     <div className="space-y-2">
                        <button
                          onClick={handleUseUltimateSkill}
                          disabled={ultimateSkillCooldown > 0}
                          className={`w-full font-bold py-3 px-4 rounded-lg transition-all duration-200 text-lg shadow-lg ${ultimateSkillCooldown > 0 ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-orange-600 hover:bg-orange-700 text-white transform hover:scale-105'}`}>
                            {ultimateSkillCooldown > 0 ? `천벌 (${ultimateSkillCooldown.toFixed(1)}s)` : `천벌 사용`}
                        </button>
                         <button onClick={() => setIsAutoAttack(p => !p)} className={`w-full font-bold py-2 px-4 rounded-lg ${isAutoAttack ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'} text-white`}>
                            {isAutoAttack ? '자동 공격 ON' : '자동 공격 OFF'}
                        </button>
                      </div>
                  </div>
                </div>
              </div>

              <div className="text-4xl font-bold self-center px-8">VS</div>

              <div className="w-1/3 p-4 bg-gray-800 rounded-lg shadow-lg text-center flex flex-col h-full">
                <h2 className={`text-2xl font-bold mb-4 ${monsterStats.isEmpowered && !isSpecialStage ? 'text-red-400' : ''}`}>{monsterName}</h2>
                <div className={`relative h-40 flex justify-center items-center ${!isAutoAttack && gameState === 'playing' ? 'cursor-pointer' : ''}`} onClick={!isAutoAttack ? performManualAttack : undefined}>
                   {/* --- 여기가 수정된 라인입니다 --- */}
                   <div className={`text-8xl transition-transform duration-200 ${monsterAnimation === 'attacking' ? 'animate-monster-attack-shake' : ''} ${monsterAnimation === 'hit' ? 'animate-flash-red' : ''}`}>
                      {isSpecialStage ? '🏃' : '👹'}
                    </div>
                  {damageDealt && <DamageText damage={damageDealt.value} isPlayer={true} isSkill={damageDealt.isSkill} isUltimate={damageDealt.isUltimate} />}
                </div>
                <div className="mt-auto space-y-2">
                  <HealthBar current={effectiveMonsterStats.hp} max={effectiveMonsterStats.maxHp} />
                  <p className="mt-2 text-lg">체력: {effectiveMonsterStats.hp} / {effectiveMonsterStats.maxHp}</p>
                  <p>공격력: {effectiveMonsterStats.attack}</p>
                  <p>방어력: {effectiveMonsterStats.defense} {monsterDebuffs.defenseReduction > 0 && <span className="text-red-400">(-{monsterDebuffs.defenseReduction * 100}%)</span>}</p>
                  {isSpecialStage && (
                    <p className="text-yellow-400 font-bold text-lg">
                      도망까지: {specialStageTimer.toFixed(1)}초
                    </p>
                  )}
                </div>
              </div>
            </div>

            <button onClick={handlePauseResume} className="absolute top-4 right-4 bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg">
              {gameState === 'paused' ? '계속하기' : '일시정지'}
            </button>
          </div>
        );
      case 'upgrade':
        return (
          <div className="text-center p-8 bg-gray-800 rounded-lg shadow-lg animate-fade-in w-full max-w-3xl">
            <h2 className="text-4xl font-bold mb-4">{isSpecialStage ? '고블린이 도망쳤습니다!' : '스테이지 클리어!'}</h2>
            
            {lastReward > 0 && <p className="text-2xl text-yellow-400 mb-2">업그레이드 포인트 +{lastReward}</p>}
            {lastCoinReward > 0 && <p className="text-2xl text-green-400 mb-6">코인 +{lastCoinReward}</p>}

            {showSkillChoice && !isReplacingSkill && (
              <div className="mb-8">
                <h3 className="text-3xl font-bold mb-4">{playerSkills.length < MAX_SKILLS ? '새로운 스킬을 선택하세요!' : '스킬을 교체하시겠습니까?'}</h3>
                {skillChoices.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {skillChoices.map(skill => (
                      <button
                        key={skill.id}
                        onClick={() => handleSelectSkill(skill)}
                        className="bg-purple-600 hover:bg-purple-700 text-white p-6 rounded-lg shadow-lg transition-transform transform hover:scale-105"
                      >
                        <h4 className="text-xl font-bold mb-2">{skill.name}</h4>
                        <p className="text-sm">{skill.description}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                   <p className="text-lg">배울 수 있는 새로운 스킬이 없습니다.</p>
                )}
              </div>
            )}
            
            {isReplacingSkill && skillToLearn && (
                <div className="mb-8 p-4 bg-gray-900 rounded-lg">
                    <h3 className="text-2xl font-bold mb-4 text-yellow-400">교체할 스킬을 선택하세요</h3>
                    <p className="mb-4">새로 배울 스킬: <span className="font-bold">{skillToLearn.name}</span> - {skillToLearn.description}</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        {playerSkills.map((skill, index) => (
                            <button
                                key={index}
                                onClick={() => handleReplaceSkill(index)}
                                className="bg-red-700 hover:bg-red-800 text-white p-4 rounded-lg shadow-lg transition-transform transform hover:scale-105"
                            >
                                <h4 className="text-lg font-bold mb-1">{skill.name}</h4>
                                <p className="text-xs">{skill.description}</p>
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={handleCancelReplace}
                        className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded-lg"
                    >
                        교체 취소
                    </button>
                </div>
            )}

            {!showSkillChoice && (
                 <div className="mb-8">
                    <h3 className="text-3xl font-bold mb-6">스탯 업그레이드 (남은 포인트: {upgradePoints})</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <button onClick={() => handleUpgrade('maxHp')} disabled={upgradePoints <= 0} className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded-lg disabled:bg-gray-600 disabled:cursor-not-allowed">
                        최대 체력 +10 (HP: {playerStats.maxHp})
                      </button>
                      <button onClick={() => handleUpgrade('attack')} disabled={upgradePoints <= 0} className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-4 rounded-lg disabled:bg-gray-600 disabled:cursor-not-allowed">
                        공격력 +2 (ATK: {playerStats.attack})
                      </button>
                      <button onClick={() => handleUpgrade('defense')} disabled={upgradePoints <= 0} className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg disabled:bg-gray-600 disabled:cursor-not-allowed">
                        방어력 +1 (DEF: {playerStats.defense})
                      </button>
                      <button onClick={() => handleUpgrade('attackInterval')} disabled={upgradePoints <= 0 || playerStats.attackInterval <= 100} className="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-4 rounded-lg disabled:bg-gray-600 disabled:cursor-not-allowed">
                        공격 속도 -50ms (AS: {playerStats.attackInterval}ms)
                      </button>
                    </div>
                </div>
            )}

             <div className="border-t border-gray-700 pt-6">
                <h3 className="text-2xl font-bold mb-4">상점 (보유 코인: {coins} 🪙)</h3>
                <button
                  onClick={handleGachaPull}
                  disabled={coins < 50}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-8 rounded-lg disabled:bg-gray-600 disabled:cursor-not-allowed"
                >
                  랜덤 능력치 뽑기 (50 🪙)
                </button>
                {gachaResult && <p className="mt-4 text-xl text-yellow-300 animate-fade-in">{gachaResult}</p>}
             </div>

            <button onClick={handleNextStage} disabled={showSkillChoice} className="mt-8 bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-10 rounded-lg text-2xl transition-colors disabled:bg-gray-600 disabled:cursor-not-allowed">
              다음 스테이지
            </button>
          </div>
        );
      case 'gameOver':
        return (
          <div className="text-center p-8 bg-gray-800 rounded-lg shadow-lg animate-fade-in">
            <h2 className="text-5xl font-bold text-red-500 mb-4">게임 오버</h2>
            <p className="text-3xl mb-8">도달한 스테이지: {stage}</p>
            <button onClick={handleRestart} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-4 px-10 rounded-lg text-2xl transition-colors">
              다시 시작
            </button>
          </div>
        );
    }
    return null;
  };

  return (
    <div className={`flex flex-col items-center justify-center min-h-screen bg-gray-900 text-white p-8 ${screenShake ? 'animate-screen-shake' : ''}`}>
      <div className="absolute top-4 left-4 text-2xl font-bold">
        {gameState === 'playing' && (isBossStage ? `스테이지: ${stage} (보스)` : `스테이지: ${stage}`)}
        {gameState === 'playing' && isSpecialStage && '특수 스테이지!'}
      </div>
      <div className="absolute top-4 right-4 text-2xl font-bold">
        {coins} 🪙
      </div>
      {renderGameContent()}
    </div>
  );
}

export default App;
