import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import type { MouseEvent } from 'react';
import './ChaoticButtonGameHardMode.css';

// ─── MongoDB scaffold ──────────────────────────────────────────────────────────
// Replace MONGO_URI with your actual connection string.
// Backend endpoint expected at /api/scores (POST)
// Schema: { username: string, totalScore: number, totalTime: number, date: Date }
// Example server snippet (Express + mongoose):
//
//   const scoreSchema = new mongoose.Schema({
//     username:   { type: String, required: true },
//     totalScore: { type: Number, required: true },
//     totalTime:  { type: Number, required: true },  // seconds
//     date:       { type: Date,   default: Date.now },
//   });
//   const Score = mongoose.model('Score', scoreSchema);
//
//   app.post('/api/scores', async (req, res) => {
//     const entry = new Score(req.body);
//     await entry.save();
//     res.json({ ok: true });
//   });
// ──────────────────────────────────────────────────────────────────────────────

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

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
  timeLimit: number;        // seconds per level (0 = no limit)
  pointsBase: number;       // base score for completing the level
}

const LEVELS: LevelConfig[] = [
  {
    label: 'Level 1 – Baby Steps',
    description: 'The button barely moves. A warm‑up.',
    numBlockers: 0, blockerSpeed: 0, escapeRadius: 60, escapeStrength: 0.05,
    randomTeleportChance: 0, windEnabled: false, flashEnabled: false,
    timeLimit: 30, pointsBase: 100,
  },
  {
    label: 'Level 2 – It Noticed You',
    description: 'The button is starting to run.',
    numBlockers: 0, blockerSpeed: 0, escapeRadius: 120, escapeStrength: 0.15,
    randomTeleportChance: 0, windEnabled: false, flashEnabled: false,
    timeLimit: 30, pointsBase: 200,
  },
  {
    label: 'Level 3 – Obstacles Appear',
    description: 'Two slow blockers patrol the arena.',
    numBlockers: 2, blockerSpeed: 1, escapeRadius: 150, escapeStrength: 0.2,
    randomTeleportChance: 0, windEnabled: false, flashEnabled: false,
    timeLimit: 35, pointsBase: 300,
  },
  {
    label: 'Level 4 – Wind Picks Up',
    description: 'A random wind now pushes the button sideways.',
    numBlockers: 2, blockerSpeed: 1.2, escapeRadius: 160, escapeStrength: 0.25,
    randomTeleportChance: 0, windEnabled: true, flashEnabled: false,
    timeLimit: 35, pointsBase: 400,
  },
  {
    label: 'Level 5 – Chaos Rising',
    description: 'Four blockers + wind + occasional random teleport.',
    numBlockers: 4, blockerSpeed: 1.5, escapeRadius: 180, escapeStrength: 0.3,
    randomTeleportChance: 0.005, windEnabled: true, flashEnabled: false,
    timeLimit: 40, pointsBase: 500,
  },
  {
    label: 'Level 6 – Lights Out',
    description: 'The screen flashes. Your eyes will lie to you.',
    numBlockers: 4, blockerSpeed: 1.8, escapeRadius: 200, escapeStrength: 0.35,
    randomTeleportChance: 0.008, windEnabled: true, flashEnabled: true,
    timeLimit: 40, pointsBase: 700,
  },
  {
    label: 'Level 7 – Six Blockers',
    description: 'Six fast obstacles and a cowardly button.',
    numBlockers: 6, blockerSpeed: 2.0, escapeRadius: 220, escapeStrength: 0.4,
    randomTeleportChance: 0.01, windEnabled: true, flashEnabled: true,
    timeLimit: 45, pointsBase: 900,
  },
  {
    label: 'Level 8 – Speed Demon',
    description: 'The button teleports constantly. Faster.',
    numBlockers: 6, blockerSpeed: 2.5, escapeRadius: 240, escapeStrength: 0.5,
    randomTeleportChance: 0.015, windEnabled: true, flashEnabled: true,
    timeLimit: 45, pointsBase: 1100,
  },
  {
    label: 'Level 9 – Almost Impossible',
    description: 'Full chaos. Eight blockers. High teleport rate.',
    numBlockers: 8, blockerSpeed: 3.0, escapeRadius: 260, escapeStrength: 0.6,
    randomTeleportChance: 0.02, windEnabled: true, flashEnabled: true,
    timeLimit: 50, pointsBase: 1400,
  },
  {
    label: 'Level 10 – HARD MODE',
    description: 'You wanted harder. Good luck.',
    numBlockers: 8, blockerSpeed: 4.0, escapeRadius: 290, escapeStrength: 0.75,
    randomTeleportChance: 0.025, windEnabled: true, flashEnabled: true,
    timeLimit: 60, pointsBase: 2000,
  },
];

type GamePhase = 'username' | 'playing' | 'levelComplete' | 'gameOver' | 'finished' | 'gambling';

interface ScoreRecord {
  username: string;
  totalScore: number;
  totalTime: number;
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
  const [levelScores, setLevelScores]     = useState<number[]>([]);
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
  const [selectedPowerup, setSelectedPowerup] = useState<'hourglass' | null>('hourglass');
  const [powerupUsed, setPowerupUsed] = useState(false);
  const [timeSlowActive, setTimeSlowActive] = useState(false);
  const [leaderboard, setLeaderboard]       = useState<ScoreRecord[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  const gameRef    = useRef<HTMLDivElement | null>(null);
  const buttonRef  = useRef<HTMLButtonElement | null>(null);
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
  const phaseRef   = useRef<GamePhase>('username');
  const levelRef   = useRef(0);

  // Keep refs in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { levelRef.current = currentLevel; }, [currentLevel]);
  useEffect(() => { billcipherVisibleRef.current = billcipherVisible; }, [billcipherVisible]);
  useEffect(() => { redHazardVisibleRef.current = redHazardVisible; }, [redHazardVisible]);
  useEffect(() => { timeSlowActiveRef.current = timeSlowActive; }, [timeSlowActive]);

  useEffect(() => {
    return () => {
      if (billcipherTimerRef.current) window.clearTimeout(billcipherTimerRef.current);
      if (redHazardTimerRef.current) window.clearTimeout(redHazardTimerRef.current);
      if (powerupTimerRef.current) window.clearTimeout(powerupTimerRef.current);
    };
  }, []);

  const config = LEVELS[currentLevel] ?? LEVELS[0];

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

  const handleUsePowerup = useCallback(() => {
    if (selectedPowerup !== 'hourglass' || powerupUsed || phaseRef.current !== 'playing') return;
    setPowerupUsed(true);
    setTimeSlowActive(true);
    timeScaleRef.current = 0.45;
    setSaveMessage('⏳ Hourglass activated! Hazards slow down for 6 seconds.');
    if (powerupTimerRef.current) window.clearTimeout(powerupTimerRef.current);
    powerupTimerRef.current = window.setTimeout(() => {
      timeScaleRef.current = 1;
      setTimeSlowActive(false);
      setSaveMessage('⏱️ Hourglass effect ended.');
    }, 6000);
  }, [powerupUsed, selectedPowerup]);

  const handleBillcipherCollision = useCallback(() => {
    setTotalScore(prev => prev - 1000);
    setSaveMessage('💀 Billcipher caught you. Level over and -1000 points.');
    setPhase('gameOver');
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
    if (buttonRef.current) randomPos(buttonRef.current);

    if (phase === 'playing') {
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
    }

    if (phase === 'gambling') {
      initGambleDots(5);
    }

    return () => {
      if (billcipherTimerRef.current) window.clearTimeout(billcipherTimerRef.current);
      if (redHazardTimerRef.current) window.clearTimeout(redHazardTimerRef.current);
    };
  }, [phase, currentLevel, randomPos, initGambleDots, initRedHazards]);

  // ── Level timer ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'playing') return;
    const cfg = LEVELS[levelRef.current];
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
    const cfg = LEVELS[levelRef.current];
    if (!cfg) return;

    let blockerFrame = 0;
    let updateFrame  = 0;
    let windInterval = 0;
    let flashTimeout = 0;

    const animateBlockers = () => {
      if (phaseRef.current !== 'playing') return;
      const game = gameRef.current;
      if (game) {
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
      const game   = gameRef.current;
      const button = buttonRef.current;
      if (game && button) {
        const bx   = button.offsetLeft + button.clientWidth / 2;
        const by   = button.offsetTop  + button.clientHeight / 2;
        const dx   = cursorXRef.current - bx;
        const dy   = cursorYRef.current - by;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (Math.random() < cfg.randomTeleportChance * timeScaleRef.current) randomPos(button);

        if (dist < cfg.escapeRadius) {
          button.style.left = `${clamp(button.offsetLeft - dx * cfg.escapeStrength, 0, game.clientWidth  - button.clientWidth)}px`;
          button.style.top  = `${clamp(button.offsetTop  - dy * cfg.escapeStrength, 0, game.clientHeight - button.clientHeight)}px`;
        }

        if (cfg.windEnabled) {
          button.style.left = `${clamp(button.offsetLeft + windForceRef.current * 0.08 * timeScaleRef.current, 0, game.clientWidth - button.clientWidth)}px`;
        }

        if (cfg.flashEnabled && Math.random() < 0.01) {
          game.classList.add('flash');
          window.clearTimeout(flashTimeout);
          flashTimeout = window.setTimeout(() => game.classList.remove('flash'), 150);
        }

        if (redHazardVisibleRef.current && redHazardDotsRef.current.length > 0) {
          redHazardDotsRef.current.forEach((hazard, index) => {
            const dxh = cursorXRef.current - hazard.x;
            const dyh = cursorYRef.current - hazard.y;
            const dh = Math.sqrt(dxh * dxh + dyh * dyh);
            const hazardSpeed = 1.8 * timeScaleRef.current;

            if (dh > 0) {
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
              setSaveMessage('💀 A red dot hit you. Level over.');
              setPhase('gameOver');
            }
          });
        }

        if (billcipherEnabledRef.current && billcipherRef.current && billcipherVisibleRef.current) {
          const bill = billcipherRef.current;
          const pos = billcipherPosRef.current;
          const dx = cursorXRef.current - pos.x;
          const dy = cursorYRef.current - pos.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const speed = billcipherSpeedRef.current * timeScaleRef.current;

          if (dist > 0) {
            const step = Math.min(speed, dist);
            pos.x += (dx / dist) * step;
            pos.y += (dy / dist) * step;
          }

          pos.x = clamp(pos.x, 0, game.clientWidth - bill.clientWidth);
          pos.y = clamp(pos.y, 0, game.clientHeight - bill.clientHeight);
          bill.style.left = `${pos.x}px`;
          bill.style.top = `${pos.y}px`;

          if (Math.hypot(pos.x - cursorXRef.current, pos.y - cursorYRef.current) < 18) {
            handleBillcipherCollision();
            return;
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

  // ── Button clicked → level complete ────────────────────────────────────
  const handleButtonClick = () => {
    if (phaseRef.current === 'playing') {
      const cfg    = LEVELS[currentLevel];
      const elapsed = cfg.timeLimit > 0
        ? cfg.timeLimit - Math.max(0, (cfg.timeLimit - (Date.now() - levelStartTime) / 1000))
        : 0;
      const score  = calcLevelScore(cfg.pointsBase, elapsed, cfg.timeLimit);
      const newScores = [...levelScores, score];
      setLevelScores(newScores);
      setTotalScore(prev => prev + score);
      setPhase('levelComplete');
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
    if (currentLevel + 1 >= LEVELS.length) {
      setPhase('finished');
    } else {
      setCurrentLevel(prev => prev + 1);
      setWind('0.0');
      windForceRef.current = 0;
      setPhase('playing');
    }
  };

  // ── Save score to MongoDB ────────────────────────────────────────────────
  const handleSaveScore = async () => {
    setSavingScore(true);
    setSaveMessage('');
    const totalTime = levelScores.length; // could track actual seconds if desired
    try {
      const res = await fetch('/api/scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, totalScore, totalTime, date: new Date() }),
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
    setCurrentLevel(0);
    setLevelScores([]);
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
                setPhase('playing');
              }
            }}
          />
          <button
            className="action-btn"
            disabled={!usernameInput.trim()}
            onClick={() => { setUsername(usernameInput.trim()); setPhase('playing'); }}
          >
            Start Game
          </button>
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

  // ─── Render: level complete screen ───────────────────────────────────────
  if (phase === 'levelComplete') {
    const lastScore = levelScores[levelScores.length - 1] ?? 0;
    const isLast    = currentLevel + 1 >= LEVELS.length;
    return (
      <div className="app-shell">
        <h1 className="title">LEVEL COMPLETE!</h1>
        <div className="overlay-card">
          <div className="level-badge">Level {currentLevel + 1} / {LEVELS.length}</div>
          <p className="score-earned">+{lastScore} pts</p>
          <p className="score-total">Total: {totalScore} pts</p>
          <div className="powerup-panel">
            <h3>Choose a powerup for the next level</h3>
            <div className="powerup-grid">
              <button
                type="button"
                className={`powerup-card${selectedPowerup === 'hourglass' ? ' selected' : ''}`}
                onClick={() => setSelectedPowerup('hourglass')}
              >
                <div className="powerup-icon" style={{ backgroundImage: 'url(/img/hourglass.png)' }} />
                <div>
                  <strong>Hourglass</strong>
                  <p>Slow hazards and enemies for 6 seconds.</p>
                </div>
              </button>
            </div>
          </div>
          <button className="action-btn" onClick={handleNextLevel}>
            {isLast ? 'Finish Game' : `Level ${currentLevel + 2} →`}
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: game over ────────────────────────────────────────────────────
  if (phase === 'gameOver') {
    return (
      <div className="app-shell">
        <h1 className="title">TIME'S UP!</h1>
        <div className="overlay-card">
          <p className="overlay-sub">You ran out of time on Level {currentLevel + 1}.</p>
          <p className="score-total">Final Score: {totalScore} pts</p>
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
            {levelScores.map((s, i) => (
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
          {config.timeLimit > 0 && (
            <div className="timer-wrap">
              <div className="timer-bar" style={{ width: `${timerPct}%`, background: timerColor }} />
              <span className="timer-text">{timeLeft}s</span>
            </div>
          )}
          {config.windEnabled && <span className="wind-display">Wind: {wind}</span>}
          <div className="powerup-hud">
            <span className="powerup-label">Powerup:</span>
            <span>{selectedPowerup === 'hourglass' ? 'Hourglass' : 'No powerup selected'}</span>
            <button
              className="action-btn secondary"
              type="button"
              onClick={handleUsePowerup}
              disabled={!selectedPowerup || powerupUsed}
            >
              {powerupUsed ? 'Powerup Used' : 'Use Hourglass'}
            </button>
            {timeSlowActive && <span className="powerup-status">⏳ Slow time active</span>}
          </div>
        </div>
      </div>

      {/* Game area */}
      <div className="game-area" ref={gameRef} onMouseMove={handleMouseMove}>
        <button className="big-button" ref={buttonRef} onClick={handleButtonClick}>
          PRESS
        </button>
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
        {Array.from({ length: config.numBlockers }).map((_, index) => (
          <div
            key={index}
            className="blocker"
            ref={(el: HTMLDivElement | null) => { blockersRef.current[index] = el; }}
          />
        ))}
      </div>

      <div className="level-progress">
        {LEVELS.map((_, i) => (
          <div
            key={i}
            className={`level-dot${i < currentLevel ? ' done' : i === currentLevel ? ' active' : ''}`}
            title={`Level ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
