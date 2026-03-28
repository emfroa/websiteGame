import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import './ChaoticButtonGameHardMode.css';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export default function ChaoticButtonGameHardMode() {
  const gameRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const blockersRef = useRef<(HTMLDivElement | null)[]>([]);
  const cursorXRef = useRef(0);
  const cursorYRef = useRef(0);
  const windForceRef = useRef(0);
  const [wind, setWind] = useState('0.0');

  const randomPos = (el: HTMLElement) => {
    const game = gameRef.current;
    if (!game) return;
    const maxX = Math.max(game.clientWidth - el.clientWidth, 0);
    const maxY = Math.max(game.clientHeight - el.clientHeight, 0);
    el.style.left = `${Math.random() * maxX}px`;
    el.style.top = `${Math.random() * maxY}px`;
  };

  useLayoutEffect(() => {
    if (buttonRef.current) randomPos(buttonRef.current);
    blockersRef.current.forEach((blocker: HTMLDivElement | null) => {
      if (blocker) randomPos(blocker);
    });
  }, []);

  useEffect(() => {
    let blockerFrame = 0;
    let updateFrame = 0;
    let windInterval = 0;
    let flashTimeout = 0;

    const animateBlockers = () => {
      const game = gameRef.current;
      if (!game) {
        blockerFrame = requestAnimationFrame(animateBlockers);
        return;
      }

      blockersRef.current.forEach((blocker: HTMLDivElement | null, index: number) => {
        if (!blocker) return;
        const x = Math.sin(Date.now() / 200 + index) * 350 + 400;
        const y = Math.cos(Date.now() / 300 + index * 3) * 230 + 250;
        blocker.style.left = `${clamp(x, 0, game.clientWidth - blocker.clientWidth)}px`;
        blocker.style.top = `${clamp(y, 0, game.clientHeight - blocker.clientHeight)}px`;
      });

      blockerFrame = requestAnimationFrame(animateBlockers);
    };

    const update = () => {
      const game = gameRef.current;
      const button = buttonRef.current;
      if (!game || !button) {
        updateFrame = requestAnimationFrame(update);
        return;
      }

      const bx = button.offsetLeft + button.clientWidth / 2;
      const by = button.offsetTop + button.clientHeight / 2;
      const dx = cursorXRef.current - bx;
      const dy = cursorYRef.current - by;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (Math.random() < 0.02) {
        randomPos(button);
      }

      if (dist < 250) {
        button.style.left = `${clamp(button.offsetLeft - dx * 0.4, 0, game.clientWidth - button.clientWidth)}px`;
        button.style.top = `${clamp(button.offsetTop - dy * 0.4, 0, game.clientHeight - button.clientHeight)}px`;
      }

      button.style.left = `${clamp(button.offsetLeft + windForceRef.current * 0.08, 0, game.clientWidth - button.clientWidth)}px`;

      if (Math.random() < 0.01) {
        game.classList.add('flash');
        window.clearTimeout(flashTimeout);
        flashTimeout = window.setTimeout(() => {
          game.classList.remove('flash');
        }, 150);
      }

      updateFrame = requestAnimationFrame(update);
    };

    animateBlockers();
    update();

    windInterval = window.setInterval(() => {
      const newWind = (Math.random() - 0.5) * 200;
      windForceRef.current = newWind;
      setWind(newWind.toFixed(1));
    }, 500);

    return () => {
      cancelAnimationFrame(blockerFrame);
      cancelAnimationFrame(updateFrame);
      window.clearInterval(windInterval);
      window.clearTimeout(flashTimeout);
    };
  }, []);

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    const game = gameRef.current;
    if (!game) return;
    const rect = game.getBoundingClientRect();
    cursorXRef.current = event.clientX - rect.left;
    cursorYRef.current = event.clientY - rect.top;
  };

  const handleClick = () => {
    if (!buttonRef.current) return;
    alert('You beat HARD MODE. Incredible.');
    randomPos(buttonRef.current);
  };

  return (
    <div className="app-shell">
      <h1 className="title">CHAOTIC HARD MODE</h1>
      <p className="description">You wanted harder. Here it is.</p>
      <div className="game-area" ref={gameRef} onMouseMove={handleMouseMove}>
        <button className="big-button" ref={buttonRef} onClick={handleClick}>
          PRESS
        </button>
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="blocker"
            ref={(element: HTMLDivElement | null) => {
              blockersRef.current[index] = element;
            }}
          />
        ))}
      </div>
      <div className="wind-display">Wind: {wind}</div>
    </div>
  );
}
