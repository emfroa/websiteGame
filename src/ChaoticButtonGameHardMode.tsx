import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import type { MouseEvent } from 'react';
import './ChaoticButtonGameHardMode.css';
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

const randomBetween = (min: number, max: number) => min + Math.random() * (max - min);

type PowerupType = 'hourglass' | 'money' | 'shield';

const POWERUP_CHOICES: Array<{ type: PowerupType; label: string; description: string; image: string }> = [
  { type: 'hourglass', label: 'Hourglass', description: 'Slow hazards for 6 seconds.', image: '/img/hourglass.png' },
  { type: 'money', label: 'Money', description: 'Double points this round.', image: '/img/money.png' },
  { type: 'shield', label: 'Shield', description: 'Immune to entities for 10 seconds.', image: '/img/shield.png' },
];

// ─── Level definitions ─────────────────────────────────────────────────────────
interface LevelConfig {
  label: string;
  description: string;
  numBlockers: number;
  blockerSpeed: number;     // multiplier on sin/cos animation speed
  escapeRadius: number;     // px – button starts fleeing cursor within this range
  escapeStrength: number;   // how hard the button runs (0.1 = gentle, 0.9 = very fast)
  randomTeleportChance: number; // 0–1 probability per frame the button randomly teleports
  windEnabled: boolean;
  flashEnabled: boolean;
  buttonCount: number;      // number of buttons to clear this round
  timeLimit: number;        // seconds per level (0 = no limit)
  pointsBase: number;       // base score for completing the level
}

const LEVELS: LevelConfig[] = [
  {
    label: 'Easy Round',
    description: 'The button barely moves. A warm‑up.',
    numBlockers: 0, blockerSpeed: 0, escapeRadius: 60, escapeStrength: 0.05,
    randomTeleportChance: 0, windEnabled: false, flashEnabled: false,
    buttonCount: 1, timeLimit: 0, pointsBase: 120,
  },
  {
    label: 'Medium Round',
    description: 'More blockers and a faster button.',
    numBlockers: 2, blockerSpeed: 1.3, escapeRadius: 140, escapeStrength: 0.2,
    randomTeleportChance: 0.002, windEnabled: true, flashEnabled: false,
    buttonCount: 2, timeLimit: 0, pointsBase: 240,
  },
  {
    label: 'Hard Round',
    description: 'Everything moves faster. Stay sharp.',
    numBlockers: 4, blockerSpeed: 2.0, escapeRadius: 200, escapeStrength: 0.4,
    randomTeleportChance: 0.006, windEnabled: true, flashEnabled: true,
    buttonCount: 3, timeLimit: 0, pointsBase: 420,
  },
];

const generateRoundConfig = (roundIndex: number): LevelConfig => {
  const stage = roundIndex < 5 ? 0 : roundIndex < 12 ? 1 : 2;
  const base = LEVELS[stage];
  return {
    label: `${base.label} #${roundIndex + 1}`,
    description: base.description,
    numBlockers: Math.min(8, Math.max(0, Math.round(base.numBlockers + randomBetween(-1, 2) + roundIndex * 0.15))),
    blockerSpeed: Math.min(4.5, Math.max(0.5, base.blockerSpeed + randomBetween(-0.4, 0.8) + roundIndex * 0.03)),
    escapeRadius: Math.min(320, Math.max(80, base.escapeRadius + randomBetween(-20, 30))),
    escapeStrength: Math.min(0.85, Math.max(0.05, base.escapeStrength + randomBetween(-0.05, 0.1) + roundIndex * 0.006)),
    randomTeleportChance: Math.min(0.018, Math.max(0, base.randomTeleportChance + randomBetween(-0.001, 0.004) + roundIndex * 0.0004)),
    windEnabled: base.windEnabled || Math.random() < 0.2,
    flashEnabled: base.flashEnabled || (stage === 2 && Math.random() < 0.25),
    buttonCount: Math.min(7, Math.max(1, Math.round(randomBetween(1, 3) + stage + roundIndex * 0.06))),
    timeLimit: 0,
    pointsBase: Math.round(base.pointsBase + roundIndex * 40 + randomBetween(-30, 40)),
  };
};

const ROUND_HISTORY_SIZE = 20;

const INITIAL_POWERUP_HISTORY: PowerupType[] = [];

const LOCAL_SAVE_KEY = 'chaotic-button-game-save';

const powerupLabel = (type: PowerupType) => ({ hourglass: 'Hourglass', money: 'Money', shield: 'Shield' }[type]);

const getDifficultyStage = (roundIndex: number) =>
  roundIndex < 5 ? 'Easy' : roundIndex < 12 ? 'Medium' : 'Hard';

type GamePhase = 'username' | 'powerupSelect' | 'playing' | 'levelComplete' | 'gameOver' | 'finished' | 'gambling';

interface ScoreRecord {
  username: string;
  totalScore: number;
  totalTime: number;
  roundsSurvived?: number;
  powerupHistory?: string[];
  date: string;
}

// ─── Score helpers ─────────────────────────────────────────────────────────────
function calcLevelScore(base: number, elapsed: number, timeLimit: number): number {
  if (timeLimit === 0) return base;
  const ratio = Math.max(0, (timeLimit - elapsed) / timeLimit);
  return Math.round(base * (0.4 + 0.6 * ratio));
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function ChaoticButtonGameHardMode() {
  const [phase, setPhase]           = useState<GamePhase>('username');
  const [username, setUsername]     = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [currentLevel, setCurrentLevel]   = useState(0);
  const [roundScores, setRoundScores]     = useState<number[]>([]);
  const [roundConfig, setRoundConfig]     = useState<LevelConfig>(() => generateRoundConfig(0));
  const [activePowerups, setActivePowerups] = useState<PowerupType[]>([]);
  const [inventory, setInventory] = useState<PowerupType[]>([]);
  const [targetButtons, setTargetButtons] = useState<number[]>([0]);
  const [selectedPowerup, setSelectedPowerup] = useState<PowerupType>('hourglass');
  const [powerupHistory, setPowerupHistory] = useState<PowerupType[]>(INITIAL_POWERUP_HISTORY);
  const [shieldActive, setShieldActive] = useState(false);
  const [localSaveAvailable, setLocalSaveAvailable] = useState(false);
  const [localLoadError, setLocalLoadError] = useState<string | null>(null);
  const [totalScore, setTotalScore]       = useState(0);
  const [wind, setWind]             = useState('0.0');
  const [timeLeft, setTimeLeft]     = useState(0);
  const [levelStartTime, setLevelStartTime] = useState(0);
  const [savingScore, setSavingScore]       = useState(false);
  const [saveMessage, setSaveMessage]       = useState('');
  const [gambleTimeLeft, setGambleTimeLeft] = useState(0);
  const [gambleOutcome, setGambleOutcome]   = useState<boolean | null>(null);
  const [gambleResult, setGambleResult]     = useState<'pending' | 'won' | 'lost' | null>(null);
  const [billcipherActive, setBillcipherActive] = useState(false);
  const [billcipherVisible, setBillcipherVisible] = useState(false);
  const [redHazardVisible, setRedHazardVisible] = useState(false);
  const [redHazardCount, setRedHazardCount] = useState(0);
  const [powerupUsed, setPowerupUsed] = useState(false);
  const [timeSlowActive, setTimeSlowActive] = useState(false);
  const [lives, setLives] = useState(3);
  const [invincible, setInvincible] = useState(false);
  const [freezeCollectibleVisible, setFreezeCollectibleVisible] = useState(false);
  const [freezePos, setFreezePos] = useState<{ x: number; y: number } | null>(null);
  const [freezeActive, setFreezeActive] = useState(false);
  const [leaderboard, setLeaderboard]       = useState<ScoreRecord[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  const gameRef    = useRef<HTMLDivElement | null>(null);
  const buttonRef  = useRef<HTMLButtonElement | null>(null);
  const targetButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const billcipherRef = useRef<HTMLDivElement | null>(null);
  const blockersRef = useRef<(HTMLDivElement | null)[]>([]);
  const gambleDotsRef = useRef<{ x: number; y: number }[]>([]);
  const gambleDotElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const redHazardDotsRef = useRef<{ x: number; y: number }[]>([]);
  const redHazardElsRef = useRef<(HTMLDivElement | null)[]>([]);
  const billcipherEnabledRef = useRef(false);
  const billcipherVisibleRef = useRef(false);
  const redHazardVisibleRef = useRef(false);
  const timeSlowActiveRef = useRef(false);
  const billcipherPosRef = useRef({ x: 0, y: 0 });
  const billcipherSpeedRef = useRef(2.3);
  const cursorXRef = useRef(0);
  const cursorYRef = useRef(0);
  const windForceRef = useRef(0);
  const timeScaleRef = useRef(1);
  const billcipherTimerRef = useRef<number | null>(null);
  const redHazardTimerRef = useRef<number | null>(null);
  const powerupTimerRef = useRef<number | null>(null);
  const shieldTimerRef = useRef<number | null>(null);
  const shieldActiveRef = useRef(false);
  const livesRef = useRef(3);
  const invincibleRef = useRef(false);
  const freezeActiveRef = useRef(false);
  const invincibleTimerRef = useRef<number | null>(null);
  const freezeTimerRef = useRef<number | null>(null);
  const freezeSpawnTimerRef = useRef<number | null>(null);
  const phaseRef   = useRef<GamePhase>('username');
  const levelRef   = useRef(0);

  // Keep refs in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { levelRef.current = currentLevel; }, [currentLevel]);
  useEffect(() => { billcipherVisibleRef.current = billcipherVisible; }, [billcipherVisible]);
  useEffect(() => { redHazardVisibleRef.current = redHazardVisible; }, [redHazardVisible]);
  useEffect(() => { timeSlowActiveRef.current = timeSlowActive; }, [timeSlowActive]);
  useEffect(() => { shieldActiveRef.current = shieldActive; }, [shieldActive]);
  useEffect(() => { livesRef.current = lives; }, [lives]);
  useEffect(() => { invincibleRef.current = invincible; }, [invincible]);
  useEffect(() => { freezeActiveRef.current = freezeActive; }, [freezeActive]);

  useEffect(() => {
    return () => {
      if (billcipherTimerRef.current) window.clearTimeout(billcipherTimerRef.current);
      if (redHazardTimerRef.current) window.clearTimeout(redHazardTimerRef.current);
      if (powerupTimerRef.current) window.clearTimeout(powerupTimerRef.current);
      if (shieldTimerRef.current) window.clearTimeout(shieldTimerRef.current);
      if (invincibleTimerRef.current) window.clearTimeout(invincibleTimerRef.current);
      if (freezeTimerRef.current) window.clearTimeout(freezeTimerRef.current);
      if (freezeSpawnTimerRef.current) window.clearTimeout(freezeSpawnTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem(LOCAL_SAVE_KEY);
    setLocalSaveAvailable(!!saved);
  }, []);

  const config = roundConfig;

  // ── Position helpers ─────────────────────────────────────────────────────
  const randomPos = useCallback((el: HTMLElement) => {
    const game = gameRef.current;
    if (!game) return;
    const maxX = Math.max(game.clientWidth - el.clientWidth, 0);
    const maxY = Math.max(game.clientHeight - el.clientHeight, 0);
    el.style.left = `${Math.random() * maxX}px`;
    el.style.top  = `${Math.random() * maxY}px`;
  }, []);

  const initGambleDots = useCallback((count = 5) => {
    const game = gameRef.current;
    if (!game) return;

    const dots = Array.from({ length: count }, () => ({
      x: Math.random() * Math.max(0, game.clientWidth - 20),
      y: Math.random() * Math.max(0, game.clientHeight - 20),
    }));

    gambleDotsRef.current = dots;
    dots.forEach((dot, index) => {
      const dotEl = gambleDotElsRef.current[index];
      if (dotEl) {
        dotEl.style.left = `${dot.x}px`;
        dotEl.style.top = `${dot.y}px`;
      }
    });
  }, []);

  const initRedHazards = useCallback((count = 5) => {
    const game = gameRef.current;
    if (!game) return;

    const hazards = Array.from({ length: count }, () => ({
      x: Math.random() * Math.max(0, game.clientWidth - 18),
      y: Math.random() * Math.max(0, game.clientHeight - 18),
    }));

    redHazardDotsRef.current = hazards;
    setRedHazardCount(count);
    hazards.forEach((hazard, index) => {
      const hazardEl = redHazardElsRef.current[index];
      if (hazardEl) {
        hazardEl.style.left = `${hazard.x}px`;
        hazardEl.style.top = `${hazard.y}px`;
      }
    });
  }, []);

  const handleStartGamble = useCallback(() => {
    setGambleOutcome(Math.random() < 0.5);
    setGambleTimeLeft(7);
    setGambleResult('pending');
    setSaveMessage('');
    setPhase('gambling');
  }, []);

  const handleActivatePowerup = useCallback((powerup: PowerupType) => {
    if (phaseRef.current !== 'playing') return;
    if (!inventory.includes(powerup)) return;

    setInventory(prev => {
      const index = prev.indexOf(powerup);
      if (index === -1) return prev;
      return [...prev.slice(0, index), ...prev.slice(index + 1)];
    });
    setActivePowerups(prev => [...prev, powerup]);
    setPowerupUsed(true);

    if (powerup === 'hourglass') {
      setTimeSlowActive(true);
      timeScaleRef.current = 0.45;
      setSaveMessage('⏳ Hourglass activated! Hazards slow down for 6 seconds.');
      if (powerupTimerRef.current) window.clearTimeout(powerupTimerRef.current);
      powerupTimerRef.current = window.setTimeout(() => {
        timeScaleRef.current = 1;
        setTimeSlowActive(false);
        setSaveMessage('⏱️ Hourglass effect ended.');
      }, 6000);
    }

    if (powerup === 'shield') {
      setShieldActive(true);
      setSaveMessage('🛡️ Shield activated! You are immune for 10 seconds.');
      if (shieldTimerRef.current) window.clearTimeout(shieldTimerRef.current);
      shieldTimerRef.current = window.setTimeout(() => {
        setShieldActive(false);
        setSaveMessage('🛡️ Shield expired.');
      }, 10000);
    }

    if (powerup === 'money') {
      setSaveMessage(prev => `${prev} 💰 Money powerup activated! Points will multiply when you complete the round.`.trim());
    }
  }, [inventory]);

  const saveLocalProgress = useCallback(() => {
    try {
      const payload = {
        phase,
        username,
        usernameInput,
        currentLevel,
        roundScores,
        roundConfig,
        activePowerups,
        targetButtons,
        inventory,
        selectedPowerup,
        powerupHistory,
        totalScore,
        wind,
        timeLeft,
        levelStartTime,
        billcipherActive,
        billcipherVisible,
        redHazardVisible,
        redHazardCount,
        powerupUsed,
        timeSlowActive,
        shieldActive,
        saveMessage,
      };
      localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(payload));
      setLocalSaveAvailable(true);
      setSaveMessage('💾 Progress saved locally.');
    } catch (error) {
      console.error('Failed to save locally', error);
      setSaveMessage('⚠️ Could not save locally.');
    }
  }, [phase, username, usernameInput, currentLevel, roundScores, roundConfig, activePowerups, targetButtons, inventory, selectedPowerup, powerupHistory, totalScore, wind, timeLeft, levelStartTime, billcipherActive, billcipherVisible, redHazardVisible, redHazardCount, powerupUsed, timeSlowActive, shieldActive, saveMessage]);

  const loadLocalProgress = useCallback(() => {
    try {
      const raw = localStorage.getItem(LOCAL_SAVE_KEY);
      if (!raw) {
        setLocalLoadError('No saved progress found.');
        return;
      }
      const data = JSON.parse(raw);
      setUsername(data.username ?? '');
      setUsernameInput(data.usernameInput ?? '');
      setCurrentLevel(data.currentLevel ?? 0);
      setRoundScores(Array.isArray(data.roundScores) ? data.roundScores : []);
      setRoundConfig(data.roundConfig ? data.roundConfig : generateRoundConfig(0));
      setActivePowerups(Array.isArray(data.activePowerups) ? data.activePowerups : []);
      setTargetButtons(Array.isArray(data.targetButtons) ? data.targetButtons : [0]);
      setInventory(Array.isArray(data.inventory) ? data.inventory : []);
      setSelectedPowerup(data.selectedPowerup ?? 'hourglass');
      setPowerupHistory(Array.isArray(data.powerupHistory) ? data.powerupHistory : []);
      setTotalScore(typeof data.totalScore === 'number' ? data.totalScore : 0);
      setWind(data.wind ?? '0.0');
      setTimeLeft(typeof data.timeLeft === 'number' ? data.timeLeft : 0);
      setLevelStartTime(typeof data.levelStartTime === 'number' ? data.levelStartTime : 0);
      setBillcipherActive(!!data.billcipherActive);
      setBillcipherVisible(!!data.billcipherVisible);
      setRedHazardVisible(!!data.redHazardVisible);
      setRedHazardCount(typeof data.redHazardCount === 'number' ? data.redHazardCount : 0);
      setPowerupUsed(!!data.powerupUsed);
      setTimeSlowActive(!!data.timeSlowActive);
      setShieldActive(!!data.shieldActive);
      setSaveMessage(data.saveMessage ?? 'Loaded saved progress.');
      setPhase(data.phase ?? 'powerupSelect');
      setLocalLoadError(null);
    } catch (error) {
      console.error('Failed to load local save', error);
      setLocalLoadError('Unable to load saved progress.');
    }
  }, []);

  const handleHit = useCallback((message: string, scorePenalty = 0) => {
    if (invincibleRef.current || shieldActiveRef.current) return;
    if (scorePenalty > 0) setTotalScore(prev => Math.max(0, prev - scorePenalty));
    const newLives = livesRef.current - 1;
    setLives(newLives);
    if (newLives <= 0) {
      setSaveMessage(message + ' No lives left.');
      setPhase('gameOver');
    } else {
      setSaveMessage(`${message} Lives remaining: ${newLives}`);
      setInvincible(true);
      if (invincibleTimerRef.current) window.clearTimeout(invincibleTimerRef.current);
      invincibleTimerRef.current = window.setTimeout(() => {
        setInvincible(false);
      }, 1500);
    }
  }, []);

  const handleBillcipherCollision = useCallback(() => {
    handleHit('💀 Billcipher caught you! -500 pts.', 500);
  }, [handleHit]);

  const handleFreezeClick = useCallback(() => {
    if (phaseRef.current !== 'playing') return;
    setFreezeCollectibleVisible(false);
    setFreezePos(null);
    setFreezeActive(true);
    freezeActiveRef.current = true;
    setSaveMessage('❄️ Enemies frozen for 3 seconds!');
    if (freezeTimerRef.current) window.clearTimeout(freezeTimerRef.current);
    freezeTimerRef.current = window.setTimeout(() => {
      setFreezeActive(false);
      freezeActiveRef.current = false;
      setSaveMessage('');
    }, 3000);
  }, []);

  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    setLeaderboardError(null);

    try {
      const res = await fetch('/api/scores');
      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data?.message || 'Failed to load leaderboard');
      }
      setLeaderboard(data.scores ?? []);
    } catch (error) {
      console.error('Leaderboard load failed', error);
      setLeaderboardError(error instanceof Error ? error.message : 'Unable to load leaderboard');
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  useEffect(() => {
    if (phase !== 'gambling') return;
    initGambleDots(5);
    setGambleTimeLeft(7);

    let animationFrame = 0;
    let intervalId = 0;
    let active = true;

    const finishGamble = (won: boolean, message: string) => {
      if (!active) return;
      active = false;
      window.clearInterval(intervalId);
      cancelAnimationFrame(animationFrame);

      if (won) {
        setTotalScore(prev => prev * 2);
        setSaveMessage('🎉 Gamble succeeded! Score doubled.');
        setGambleResult('won');
      } else {
        setTotalScore(0);
        setSaveMessage(message);
        setGambleResult('lost');
      }
      setPhase('finished');
    };

    const animateDots = () => {
      if (!active || phaseRef.current !== 'gambling') return;
      const game = gameRef.current;
      if (game) {
        gambleDotsRef.current.forEach((dot, index) => {
          const dx = cursorXRef.current - dot.x;
          const dy = cursorYRef.current - dot.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const speed = 2.5;

          if (dist > 0) {
            const step = Math.min(speed, dist);
            dot.x += (dx / dist) * step;
            dot.y += (dy / dist) * step;
          }

          dot.x = clamp(dot.x, 0, game.clientWidth - 16);
          dot.y = clamp(dot.y, 0, game.clientHeight - 16);

          const dotEl = gambleDotElsRef.current[index];
          if (dotEl) {
            dotEl.style.left = `${dot.x}px`;
            dotEl.style.top = `${dot.y}px`;
          }

          if (Math.hypot(dot.x - cursorXRef.current, dot.y - cursorYRef.current) < 16) {
            finishGamble(false, '💀 You were touched by a red hunter. Score lost.');
          }
        });

        const button = buttonRef.current;
        if (button) {
          const bx = button.offsetLeft + button.clientWidth / 2;
          const by = button.offsetTop + button.clientHeight / 2;
          const dx = cursorXRef.current - bx;
          const dy = cursorYRef.current - by;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (Math.random() < 0.015) randomPos(button);
          if (dist < 220) {
            button.style.left = `${clamp(button.offsetLeft - dx * 0.25, 0, game.clientWidth - button.clientWidth)}px`;
            button.style.top  = `${clamp(button.offsetTop - dy * 0.25, 0, game.clientHeight - button.clientHeight)}px`;
          }
        }
      }
      if (active) {
        animationFrame = requestAnimationFrame(animateDots);
      }
    };

    animateDots();

    const startTime = Date.now();
    intervalId = window.setInterval(() => {
      if (!active || phaseRef.current !== 'gambling') return;
      const elapsed = (Date.now() - startTime) / 1000;
      const remaining = Math.max(0, 7 - elapsed);
      setGambleTimeLeft(Math.ceil(remaining));
      if (remaining <= 0) {
        finishGamble(false, '💀 Time ran out. Score lost.');
      }
    }, 150);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      cancelAnimationFrame(animationFrame);
    };
  }, [phase, initGambleDots, gambleOutcome]);

  // ── Initial placement when level starts ──────────────────────────────────
  useLayoutEffect(() => {
    if (phase !== 'playing' && phase !== 'gambling') return;

    if (phase === 'playing') {
      const nextConfig = generateRoundConfig(currentLevel);
      setRoundConfig(nextConfig);
      setTargetButtons(Array.from({ length: nextConfig.buttonCount }, (_, i) => i));
      if (buttonRef.current) randomPos(buttonRef.current);
      targetButtonRefs.current.forEach(btn => { if (btn) randomPos(btn); });
      blockersRef.current.forEach(b => { if (b) randomPos(b); });
      const hasBillcipher = Math.random() < 0.4; // 40% chance to have Billcipher in this level
      setBillcipherActive(hasBillcipher);
      setBillcipherVisible(false);
      billcipherEnabledRef.current = hasBillcipher;
      if (hasBillcipher && billcipherRef.current) {
        randomPos(billcipherRef.current);
        billcipherPosRef.current = {
          x: billcipherRef.current.offsetLeft,
          y: billcipherRef.current.offsetTop,
        };
      }
      setRedHazardVisible(false);
      setRedHazardCount(0);
      if (redHazardTimerRef.current) window.clearTimeout(redHazardTimerRef.current);
      if (billcipherTimerRef.current) window.clearTimeout(billcipherTimerRef.current);
      if (powerupTimerRef.current) window.clearTimeout(powerupTimerRef.current);
      redHazardTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current === 'playing' && Math.random() < 0.2) {
          setRedHazardVisible(true);
          initRedHazards(5);
        }
      }, 3000);
      billcipherTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current === 'playing' && billcipherEnabledRef.current) {
          setBillcipherVisible(true);
        }
      }, 3000);
      setPowerupUsed(false);
      setTimeSlowActive(false);
      timeScaleRef.current = 1;
      setInvincible(false);
      invincibleRef.current = false;
      setFreezeCollectibleVisible(false);
      setFreezePos(null);
      setFreezeActive(false);
      freezeActiveRef.current = false;
      if (freezeSpawnTimerRef.current) window.clearTimeout(freezeSpawnTimerRef.current);
      if (freezeTimerRef.current) window.clearTimeout(freezeTimerRef.current);
      freezeSpawnTimerRef.current = window.setTimeout(() => {
        if (phaseRef.current !== 'playing') return;
        const game = gameRef.current;
        if (!game) return;
        setFreezePos({
          x: randomBetween(20, game.clientWidth - 60),
          y: randomBetween(20, game.clientHeight - 60),
        });
        setFreezeCollectibleVisible(true);
        freezeSpawnTimerRef.current = window.setTimeout(() => {
          setFreezeCollectibleVisible(false);
          setFreezePos(null);
        }, 8000);
      }, 5000 + Math.random() * 4000);
    }

    if (phase === 'gambling') {
      initGambleDots(5);
    }

    return () => {
      if (billcipherTimerRef.current) window.clearTimeout(billcipherTimerRef.current);
      if (redHazardTimerRef.current) window.clearTimeout(redHazardTimerRef.current);
      if (freezeSpawnTimerRef.current) window.clearTimeout(freezeSpawnTimerRef.current);
    };
  }, [phase, currentLevel, randomPos, initGambleDots, initRedHazards]);

  // ── Level timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return;
    const cfg = roundConfig;
    if (!cfg || cfg.timeLimit === 0) return;

    const start = Date.now();
    setLevelStartTime(start);
    setTimeLeft(cfg.timeLimit);

    const id = setInterval(() => {
      if (phaseRef.current !== 'playing') { clearInterval(id); return; }
      const remaining = Math.max(0, cfg.timeLimit - (Date.now() - start) / 1000);
      setTimeLeft(Math.ceil(remaining));
      if (remaining <= 0) {
        clearInterval(id);
        setPhase('gameOver');
      }
    }, 200);
    return () => clearInterval(id);
  }, [phase, currentLevel]);

  // ── Game animation loop ──────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return;
    const cfg = roundConfig;
    if (!cfg) return;

    let blockerFrame = 0;
    let updateFrame  = 0;
    let windInterval = 0;
    let flashTimeout = 0;

    const animateBlockers = () => {
      if (phaseRef.current !== 'playing') return;
      const game = gameRef.current;
      if (game && !freezeActiveRef.current) {
        blockersRef.current.forEach((blocker, index) => {
          if (!blocker) return;
          const t = Date.now() * cfg.blockerSpeed * timeScaleRef.current;
          const x = Math.sin(t / 200 + index) * 350 + 400;
          const y = Math.cos(t / 300 + index * 3) * 230 + 250;
          blocker.style.left = `${clamp(x, 0, game.clientWidth  - blocker.clientWidth)}px`;
          blocker.style.top  = `${clamp(y, 0, game.clientHeight - blocker.clientHeight)}px`;
        });
      }
      blockerFrame = requestAnimationFrame(animateBlockers);
    };

    const update = () => {
      if (phaseRef.current !== 'playing') return;
      const game = gameRef.current;
      const buttons = [buttonRef.current, ...targetButtonRefs.current].filter(Boolean) as HTMLButtonElement[];
      if (game && buttons.length > 0) {
        buttons.forEach(button => {
          const bx   = button.offsetLeft + button.clientWidth / 2;
          const by   = button.offsetTop  + button.clientHeight / 2;
          const dx   = cursorXRef.current - bx;
          const dy   = cursorYRef.current - by;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (!freezeActiveRef.current) {
            if (Math.random() < cfg.randomTeleportChance * timeScaleRef.current) randomPos(button);

            if (dist < cfg.escapeRadius) {
              button.style.left = `${clamp(button.offsetLeft - dx * cfg.escapeStrength, 0, game.clientWidth  - button.clientWidth)}px`;
              button.style.top  = `${clamp(button.offsetTop  - dy * cfg.escapeStrength, 0, game.clientHeight - button.clientHeight)}px`;
            }

            if (cfg.windEnabled) {
              button.style.left = `${clamp(button.offsetLeft + windForceRef.current * 0.08 * timeScaleRef.current, 0, game.clientWidth - button.clientWidth)}px`;
            }
          }
        });

        if (cfg.flashEnabled && Math.random() < 0.01) {
          game.classList.add('flash');
          window.clearTimeout(flashTimeout);
          flashTimeout = window.setTimeout(() => game.classList.remove('flash'), 150);
        }
      }

      if (game) {
      if (redHazardVisibleRef.current && redHazardDotsRef.current.length > 0) {
          redHazardDotsRef.current.forEach((hazard, index) => {
            const dxh = cursorXRef.current - hazard.x;
            const dyh = cursorYRef.current - hazard.y;
            const dh = Math.sqrt(dxh * dxh + dyh * dyh);
            const hazardSpeed = freezeActiveRef.current ? 0 : 1.8 * timeScaleRef.current;

            if (dh > 0 && hazardSpeed > 0) {
              const step = Math.min(hazardSpeed, dh);
              hazard.x += (dxh / dh) * step;
              hazard.y += (dyh / dh) * step;
            }

            hazard.x = clamp(hazard.x, 0, game.clientWidth - 18);
            hazard.y = clamp(hazard.y, 0, game.clientHeight - 18);
            const hazardEl = redHazardElsRef.current[index];
            if (hazardEl) {
              hazardEl.style.left = `${hazard.x}px`;
              hazardEl.style.top = `${hazard.y}px`;
            }

            if (Math.hypot(hazard.x - cursorXRef.current, hazard.y - cursorYRef.current) < 18) {
              handleHit('💀 A red dot hit you!');
            }
          });
        }

        if (billcipherEnabledRef.current && billcipherRef.current && billcipherVisibleRef.current) {
          const bill = billcipherRef.current;
          const pos = billcipherPosRef.current;
          const dx = cursorXRef.current - pos.x;
          const dy = cursorYRef.current - pos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const speed = freezeActiveRef.current ? 0 : billcipherSpeedRef.current * timeScaleRef.current;

          if (dist > 0 && speed > 0) {
            const step = Math.min(speed, dist);
            pos.x += (dx / dist) * step;
            pos.y += (dy / dist) * step;
          }

          pos.x = clamp(pos.x, 0, game.clientWidth - bill.clientWidth);
          pos.y = clamp(pos.y, 0, game.clientHeight - bill.clientHeight);
          bill.style.left = `${pos.x}px`;
          bill.style.top = `${pos.y}px`;

          if (Math.hypot(pos.x - cursorXRef.current, pos.y - cursorYRef.current) < 18) {
            if (!shieldActiveRef.current) {
              handleBillcipherCollision();
              return;
            }
          }
        }
      }
      updateFrame = requestAnimationFrame(update);
    };

    if (cfg.numBlockers > 0) animateBlockers();
    update();

    if (cfg.windEnabled) {
      windInterval = window.setInterval(() => {
        if (phaseRef.current !== 'playing') return;
        const newWind = (Math.random() - 0.5) * 200;
        windForceRef.current = newWind;
        setWind(newWind.toFixed(1));
      }, 500);
    }

    return () => {
      cancelAnimationFrame(blockerFrame);
      cancelAnimationFrame(updateFrame);
      window.clearInterval(windInterval);
      window.clearTimeout(flashTimeout);
    };
  }, [phase, currentLevel, randomPos]);

  // ── Mouse tracking ───────────────────────────────────────────────────────
  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const game = gameRef.current;
    if (!game) return;
    const rect = game.getBoundingClientRect();
    cursorXRef.current = event.clientX - rect.left;
    cursorYRef.current = event.clientY - rect.top;
  };

  const completeTargetRound = useCallback(() => {
    const cfg = roundConfig;
    const elapsed = cfg.timeLimit > 0
      ? cfg.timeLimit - Math.max(0, (cfg.timeLimit - (Date.now() - levelStartTime) / 1000))
      : 0;
    let score = calcLevelScore(cfg.pointsBase, elapsed, cfg.timeLimit);
    const moneyCount = activePowerups.filter(p => p === 'money').length;
    if (moneyCount > 0) {
      const multiplier = 2 ** moneyCount;
      score *= multiplier;
      setSaveMessage(`💰 Money powerup active! Score x${multiplier}.`);
    }
    const newScores = [...roundScores, score];
    setRoundScores(newScores);
    setTotalScore(prev => prev + score);
    setActivePowerups([]);
    setPowerupUsed(false);
    setShieldActive(false);
    setTimeSlowActive(false);
    setPhase('levelComplete');
  }, [activePowerups, levelStartTime, roundConfig, roundScores]);

  const handleTargetClick = useCallback((id: number) => {
    if (phaseRef.current !== 'playing') return;
    const remaining = targetButtons.filter(buttonId => buttonId !== id);
    setTargetButtons(remaining);
    if (remaining.length === 0) {
      completeTargetRound();
    }
  }, [completeTargetRound, targetButtons]);

  const handleButtonClick = () => {
    if (phaseRef.current === 'playing') {
      handleTargetClick(0);
      return;
    }

    if (phaseRef.current === 'gambling') {
      if (gambleOutcome) {
        setTotalScore(prev => prev * 2);
        setSaveMessage('🎉 You clicked the gamble button! Score doubled.');
        setGambleResult('won');
      } else {
        setTotalScore(0);
        setSaveMessage('💀 You clicked the button, but the gamble failed.');
        setGambleResult('lost');
      }
      setPhase('finished');
    }
  };

  // ── Advance to next level or finish ─────────────────────────────────────
  const handleNextLevel = () => {
    const nextIndex = currentLevel + 1;
    const nextConfig = generateRoundConfig(nextIndex);
    setCurrentLevel(nextIndex);
    setRoundConfig(nextConfig);
    setTargetButtons(Array.from({ length: nextConfig.buttonCount }, (_, i) => i));
    setWind('0.0');
    windForceRef.current = 0;
    setActivePowerups([]);
    setPowerupUsed(false);
    const nextPhase = (nextIndex + 1) % 5 === 0 ? 'powerupSelect' : 'playing';
    setPhase(nextPhase);
  };

  // ── Save score to MongoDB ────────────────────────────────────────────────
  const handleSaveScore = async () => {
    setSavingScore(true);
    setSaveMessage('');
    const totalTime = roundScores.length; // could track actual seconds if desired
    try {
      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          totalScore,
          totalTime,
          date: new Date(),
          roundsSurvived: roundScores.length,
          powerupHistory,
        }),
      });
      if (res.ok) {
        setSaveMessage('✅ Score saved! Check the leaderboard.');
        await loadLeaderboard();
      } else {
        const data = await res.json().catch(() => null);
        setSaveMessage(`⚠️ Server error. ${data?.message ?? 'Score not saved.'}`);
      }
    } catch {
      setSaveMessage('⚠️ Could not reach server. Score not saved.');
    } finally {
      setSavingScore(false);
    }
  };

  // ── Restart ──────────────────────────────────────────────────────────────
  const handleRestart = () => {
    if (powerupTimerRef.current) window.clearTimeout(powerupTimerRef.current);
    if (billcipherTimerRef.current) window.clearTimeout(billcipherTimerRef.current);
    if (redHazardTimerRef.current) window.clearTimeout(redHazardTimerRef.current);
    if (shieldTimerRef.current) window.clearTimeout(shieldTimerRef.current);
    if (invincibleTimerRef.current) window.clearTimeout(invincibleTimerRef.current);
    if (freezeTimerRef.current) window.clearTimeout(freezeTimerRef.current);
    if (freezeSpawnTimerRef.current) window.clearTimeout(freezeSpawnTimerRef.current);
    setLives(3);
    livesRef.current = 3;
    setInvincible(false);
    invincibleRef.current = false;
    setFreezeCollectibleVisible(false);
    setFreezePos(null);
    setFreezeActive(false);
    freezeActiveRef.current = false;
    setCurrentLevel(0);
    setRoundScores([]);
    setRoundConfig(generateRoundConfig(0));
    setActivePowerups([]);
    setTargetButtons([0]);
    setInventory([]);
    setSelectedPowerup('hourglass');
    setPowerupHistory([]);
    setPowerupUsed(false);
    setShieldActive(false);
    setTotalScore(0);
    setWind('0.0');
    windForceRef.current = 0;
    setGambleTimeLeft(0);
    setGambleOutcome(null);
    setGambleResult(null);
    gambleDotsRef.current = [];
    setBillcipherVisible(false);
    setRedHazardVisible(false);
    setRedHazardCount(0);
    setTimeSlowActive(false);
    timeScaleRef.current = 1;
    setSaveMessage('');
    setLocalLoadError(null);
    setPhase('username');
  };

  // ─── Render: username screen ──────────────────────────────────────────────
  if (phase === 'username') {
    return (
      <div className="app-shell">
        <h1 className="title">CHAOTIC BUTTON GAME</h1>
        <div className="overlay-card">
          <h2>Enter Your Username</h2>
          <p className="overlay-sub">Your score will be saved to the leaderboard.</p>
          <input
            className="username-input"
            type="text"
            placeholder="Your name..."
            maxLength={20}
            value={usernameInput}
            onChange={e => setUsernameInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && usernameInput.trim()) {
                setUsername(usernameInput.trim());
                setPhase('powerupSelect');
              }
            }}
          />
          <button
            className="action-btn"
            disabled={!usernameInput.trim()}
            onClick={() => { setUsername(usernameInput.trim()); setPhase('powerupSelect'); }}
          >
            Start Game
          </button>
          {localSaveAvailable && (
            <button
              type="button"
              className="action-btn secondary"
              onClick={loadLocalProgress}
            >
              Continue Saved Game
            </button>
          )}
          {localLoadError && <p className="error-msg">{localLoadError}</p>}
          <div className="leaderboard-card">
            <h3>Leaderboard</h3>
            {leaderboardLoading ? (
              <p>Loading leaderboard…</p>
            ) : leaderboardError ? (
              <p className="error-msg">{leaderboardError}</p>
            ) : leaderboard.length === 0 ? (
              <p>No scores yet.</p>
            ) : (
              <div className="leaderboard-table">
                {leaderboard.slice(0, 10).map((entry, index) => (
                  <div key={index} className="leaderboard-row">
                    <span>{index + 1}. {entry.username}</span>
                    <span>{entry.totalScore} pts</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (phase === 'powerupSelect') {
    const roundNumber = currentLevel + 1;
    return (
      <div className="app-shell">
        <h1 className="title">ROUND {roundNumber}</h1>
        <div className="overlay-card">
          <h2>Choose your powerup for this round</h2>
          <p className="overlay-sub">Every 5 rounds you unlock a new powerup for your inventory.</p>
          <div className="powerup-grid">
            {POWERUP_CHOICES.map(powerup => (
              <button
                key={powerup.type}
                type="button"
                className={`powerup-card${selectedPowerup === powerup.type ? ' selected' : ''}`}
                onClick={() => setSelectedPowerup(powerup.type)}
              >
                <div className="powerup-icon" style={{ backgroundImage: `url(${powerup.image})` }} />
                <div>
                  <strong>{powerup.label}</strong>
                  <p>{powerup.description}</p>
                </div>
              </button>
            ))}
          </div>
          <button
            className="action-btn"
            onClick={() => {
              setInventory(prev => [...prev, selectedPowerup]);
              setPowerupHistory(prev => [...prev, selectedPowerup]);
              setPowerupUsed(false);
              setPhase('playing');
            }}
          >
            Add {powerupLabel(selectedPowerup)} and Start Round {roundNumber}
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: level complete screen ───────────────────────────────────────
  if (phase === 'levelComplete') {
    const lastScore = roundScores[roundScores.length - 1] ?? 0;
    const roundNumber = currentLevel + 1;
    return (
      <div className="app-shell">
        <h1 className="title">ROUND COMPLETE!</h1>
        <div className="overlay-card">
          <div className="level-badge">Round {roundNumber}</div>
          <p className="score-earned">+{lastScore} pts</p>
          <p className="score-total">Total: {totalScore} pts</p>
          <p className="overlay-sub">Survive the next round as long as you can.</p>
          <button className="action-btn" onClick={handleNextLevel}>
            Continue
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: game over ────────────────────────────────────────────────────
  if (phase === 'gameOver') {
    return (
      <div className="app-shell">
        <h1 className="title">GAME OVER</h1>
        <div className="overlay-card">
          <p className="overlay-sub">{saveMessage || `You were hit during round ${currentLevel + 1}.`}</p>
          <p className="score-total">Final Score: {totalScore} pts</p>
          {saveMessage ? (
            <p className="save-msg">{saveMessage}</p>
          ) : (
            <button className="action-btn" onClick={handleSaveScore} disabled={savingScore}>
              {savingScore ? 'Saving…' : 'Save Score to Leaderboard'}
            </button>
          )}
          <button className="action-btn danger" onClick={handleRestart}>Try Again</button>
        </div>
      </div>
    );
  }

  // ─── Render: finished (all levels) ───────────────────────────────────────
  if (phase === 'finished') {
    return (
      <div className="app-shell">
        <h1 className="title">🏆 YOU WIN!</h1>
        <div className="overlay-card">
          <p className="overlay-sub">Player: <strong>{username}</strong></p>
          <div className="score-breakdown">
            {roundScores.map((s, i) => (
              <div key={i} className="score-row">
                <span>Level {i + 1}</span>
                <span>{s} pts</span>
              </div>
            ))}
            <div className="score-row total-row">
              <span>TOTAL</span>
              <span>{totalScore} pts</span>
            </div>
          </div>
          {saveMessage
            ? <p className="save-msg">{saveMessage}</p>
            : (
              <button className="action-btn" onClick={handleSaveScore} disabled={savingScore}>
                {savingScore ? 'Saving…' : 'Save Score to Leaderboard'}
              </button>
            )
          }
          <div className="leaderboard-card">
            <h3>Leaderboard</h3>
            {leaderboardLoading ? (
              <p>Loading leaderboard…</p>
            ) : leaderboardError ? (
              <p className="error-msg">{leaderboardError}</p>
            ) : leaderboard.length === 0 ? (
              <p>No scores yet.</p>
            ) : (
              <div className="leaderboard-table">
                {leaderboard.slice(0, 10).map((entry, index) => (
                  <div key={index} className="leaderboard-row">
                    <span>{index + 1}. {entry.username}</span>
                    <span>{entry.totalScore} pts</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="action-btn secondary" onClick={handleStartGamble}>Gamble your score</button>
          <button className="action-btn secondary" onClick={handleRestart}>Play Again</button>
        </div>
      </div>
    );
  }

  // ─── Render: gambling ─────────────────────────────────────────────────────
  if (phase === 'gambling') {
    return (
      <div className="app-shell">
        <h1 className="title">GAMBLE MODE</h1>
        <div className="overlay-card">
          <p className="overlay-sub">Survive the red hunters for 7 seconds.</p>
          <p className="score-total">Current Score: {totalScore} pts</p>
          <p className="score-total">Time remaining: {gambleTimeLeft}s</p>
          <p className="score-total">Click the moving button before the red hunters catch you.</p>
          <p className="score-total">When you click: 50% double score, 50% lose everything.</p>
          <button className="action-btn danger" onClick={() => {
            setTotalScore(0);
            setGambleResult('lost');
            setSaveMessage('💀 You gave up. Score lost.');
            setPhase('finished');
          }}>
            Give Up
          </button>
        </div>
        <div className="game-area" ref={gameRef} onMouseMove={handleMouseMove}>
          <button className="big-button" ref={buttonRef} onClick={handleButtonClick}>
            PRESS
          </button>
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="gamble-dot"
              ref={(el: HTMLDivElement | null) => { gambleDotElsRef.current[index] = el; }}
            />
          ))}
        </div>
      </div>
    );
  }

  // ─── Render: playing ─────────────────────────────────────────────────────
  const timerPct    = config.timeLimit > 0 ? (timeLeft / config.timeLimit) * 100 : 100;
  const timerColor  = timerPct > 50 ? '#0f0' : timerPct > 20 ? '#ff0' : '#f00';

  return (
    <div className="app-shell">
      {/* HUD */}
      <div className="hud">
        <div className="hud-left">
          <span className="hud-label">{config.label}</span>
          <span className="hud-sub">{config.description}</span>
        </div>
        <div className="hud-right">
          <span className="hud-score">Score: {totalScore}</span>
          <div className="lives-display">
            {Array.from({ length: 3 }).map((_, i) => (
              <span key={i} className={`heart${i < lives ? '' : ' heart-empty'}`}>♥</span>
            ))}
          </div>
          {config.timeLimit > 0 && (
            <div className="timer-wrap">
              <div className="timer-bar" style={{ width: `${timerPct}%`, background: timerColor }} />
              <span className="timer-text">{timeLeft}s</span>
            </div>
          )}
          {config.windEnabled && <span className="wind-display">Wind: {wind}</span>}
          <span className="hud-label">Targets: {targetButtons.length}</span>
          <button className="action-btn secondary" type="button" onClick={saveLocalProgress}>
            Save Progress
          </button>
          <div className="powerup-hud">
            <span className="powerup-label">Inventory:</span>
            {inventory.length === 0 ? (
              <span>None</span>
            ) : (
              <div className="inventory-list">
                {inventory.map((powerup, index) => (
                  <span key={`${powerup}-${index}`} className="inventory-chip">
                    {powerupLabel(powerup)}
                  </span>
                ))}
              </div>
            )}
            {inventory.length > 0 && (
              <div className="inventory-actions">
                {inventory.map((powerup, index) => (
                  <button
                    key={`${powerup}-btn-${index}`}
                    className="action-btn secondary"
                    type="button"
                    onClick={() => handleActivatePowerup(powerup)}
                  >
                    Use {powerupLabel(powerup)}
                  </button>
                ))}
              </div>
            )}
            {activePowerups.length > 0 && (
              <div className="active-powerup-list">
                <span className="powerup-label">Active powerups:</span>
                {activePowerups.map((powerup, index) => (
                  <span key={`${powerup}-${index}`} className="powerup-chip">
                    {powerupLabel(powerup)}
                  </span>
                ))}
              </div>
            )}
            {shieldActive && <span className="powerup-status">🛡️ Shield active</span>}
            {timeSlowActive && <span className="powerup-status">⏳ Slow time active</span>}
            {freezeActive && <span className="powerup-status freeze-status">❄️ Enemies frozen!</span>}
            {invincible && <span className="powerup-status invincible-status">💫 Invincible!</span>}
            {activePowerups.filter(p => p === 'money').length > 0 && (
              <span className="powerup-status">💰 Points will multiply this round</span>
            )}
          </div>
        </div>
      </div>

      {/* Game area */}
      <div className={`game-area${invincible ? ' invincible-flash' : ''}`} ref={gameRef} onMouseMove={handleMouseMove}>
        {targetButtons.includes(0) && (
          <button className="big-button" ref={buttonRef} onClick={() => handleTargetClick(0)}>
            PRESS
          </button>
        )}
        {targetButtons.filter(id => id !== 0).map((id) => (
          <button
            key={id}
            className="big-button extra-button"
            ref={(el: HTMLButtonElement | null) => { targetButtonRefs.current[id - 1] = el; }}
            onClick={() => handleTargetClick(id)}
          >
            PRESS
          </button>
        ))}
        {billcipherActive && (
          <div className={`billcipher${billcipherVisible ? ' active' : ''}`} ref={billcipherRef} />
        )}
        {redHazardVisible && Array.from({ length: redHazardCount }).map((_, index) => (
          <div
            key={`red-${index}`}
            className="red-hazard"
            ref={(el: HTMLDivElement | null) => { redHazardElsRef.current[index] = el; }}
          />
        ))}
        {freezeCollectibleVisible && freezePos && (
          <div
            className="freeze-collectible"
            style={{ left: freezePos.x, top: freezePos.y }}
            onClick={handleFreezeClick}
          >
            ❄️
          </div>
        )}
        {freezeActive && <div className="freeze-overlay" />}
        {Array.from({ length: config.numBlockers }).map((_, index) => (
          <div
            key={index}
            className="blocker"
            ref={(el: HTMLDivElement | null) => { blockersRef.current[index] = el; }}
          />
        ))}
      </div>

      <div className="level-progress">
        <span>Round {currentLevel + 1}</span>
        <span>{getDifficultyStage(currentLevel)} difficulty</span>
      </div>
    </div>
  );
}
