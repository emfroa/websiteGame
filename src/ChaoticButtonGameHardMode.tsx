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

type GamePhase = 'username' | 'playing' | 'levelComplete' | 'gameOver' | 'finished';

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

  const gameRef    = useRef<HTMLDivElement | null>(null);
  const buttonRef  = useRef<HTMLButtonElement | null>(null);
  const blockersRef = useRef<(HTMLDivElement | null)[]>([]);
  const cursorXRef = useRef(0);
  const cursorYRef = useRef(0);
  const windForceRef = useRef(0);
  const phaseRef   = useRef<GamePhase>('username');
  const levelRef   = useRef(0);

  // Keep refs in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { levelRef.current = currentLevel; }, [currentLevel]);

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

  // ── Initial placement when level starts ──────────────────────────────────
  useLayoutEffect(() => {
    if (phase !== 'playing') return;
    if (buttonRef.current) randomPos(buttonRef.current);
    blockersRef.current.forEach(b => { if (b) randomPos(b); });
  }, [phase, currentLevel, randomPos]);

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
          const t = Date.now() * cfg.blockerSpeed;
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

        if (Math.random() < cfg.randomTeleportChance) randomPos(button);

        if (dist < cfg.escapeRadius) {
          button.style.left = `${clamp(button.offsetLeft - dx * cfg.escapeStrength, 0, game.clientWidth  - button.clientWidth)}px`;
          button.style.top  = `${clamp(button.offsetTop  - dy * cfg.escapeStrength, 0, game.clientHeight - button.clientHeight)}px`;
        }

        if (cfg.windEnabled) {
          button.style.left = `${clamp(button.offsetLeft + windForceRef.current * 0.08, 0, game.clientWidth - button.clientWidth)}px`;
        }

        if (cfg.flashEnabled && Math.random() < 0.01) {
          game.classList.add('flash');
          window.clearTimeout(flashTimeout);
          flashTimeout = window.setTimeout(() => game.classList.remove('flash'), 150);
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
    if (phaseRef.current !== 'playing') return;
    const cfg    = LEVELS[currentLevel];
    const elapsed = cfg.timeLimit > 0
      ? cfg.timeLimit - Math.max(0, (cfg.timeLimit - (Date.now() - levelStartTime) / 1000))
      : 0;
    const score  = calcLevelScore(cfg.pointsBase, elapsed, cfg.timeLimit);
    const newScores = [...levelScores, score];
    setLevelScores(newScores);
    setTotalScore(prev => prev + score);
    setPhase('levelComplete');
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
      } else {
        setSaveMessage('⚠️ Server error. Score not saved.');
      }
    } catch {
      setSaveMessage('⚠️ Could not reach server. Score not saved.');
    } finally {
      setSavingScore(false);
    }
  };

  // ── Restart ──────────────────────────────────────────────────────────────
  const handleRestart = () => {
    setCurrentLevel(0);
    setLevelScores([]);
    setTotalScore(0);
    setWind('0.0');
    windForceRef.current = 0;
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
          <button className="action-btn secondary" onClick={handleRestart}>Play Again</button>
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
        </div>
      </div>

      {/* Game area */}
      <div className="game-area" ref={gameRef} onMouseMove={handleMouseMove}>
        <button className="big-button" ref={buttonRef} onClick={handleButtonClick}>
          PRESS
        </button>
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
