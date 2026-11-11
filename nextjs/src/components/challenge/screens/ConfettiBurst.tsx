'use client';

import { useEffect, useRef } from 'react';

import { soundEffects } from '@/lib/audio/soundEffects';

interface ConfettiBurstProps {
  theme?: string;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  tilt: number;
  tiltAngle: number;
  tiltSpeed: number;
  shape: 'rect' | 'circle' | 'ribbon';
  opacity: number;
  decay: number;
}

const THEME_PALETTES: Record<string, string[]> = {
  default: ['#2f6fed', '#4c85fb', '#fbbf24', '#22c55e', '#ec4899', '#a78bfa'],
  cyberpunk: ['#8b5cf6', '#a78bfa', '#ec4899', '#06b6d4', '#fbbf24', '#f472b6'],
  emerald: ['#16a34a', '#22c55e', '#4ade80', '#fbbf24', '#2dd4bf', '#a3e635'],
  sunset: ['#d97706', '#f59e0b', '#fbbf24', '#ef4444', '#ec4899', '#fb923c'],
  crimson: ['#dc2626', '#ef4444', '#f87171', '#fbbf24', '#f472b6', '#fb923c'],
};

/**
 * Explosão de confetes em Canvas 2D exibida quando o participante acerta o desafio
 * e a opção "Efeitos e confetes no acerto" (`showFeedbackAnimation`) está ativa.
 */
export function ConfettiBurst({ theme = 'default' }: ConfettiBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    soundEffects.playSuccess();

    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const palette = THEME_PALETTES[theme] ?? THEME_PALETTES.default;
    const shapes: Particle['shape'][] = ['rect', 'circle', 'ribbon'];
    const particles: Particle[] = [];

    const createWave = (originX: number, originY: number, count: number, spreadAngle: number, baseAngle: number) => {
      for (let i = 0; i < count; i++) {
        const angle = baseAngle + (Math.random() - 0.5) * spreadAngle;
        const speed = 9 + Math.random() * 14;
        particles.push({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 2,
          size: 6 + Math.random() * 6,
          color: palette[Math.floor(Math.random() * palette.length)],
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.2,
          tilt: Math.random() * 10,
          tiltAngle: Math.random() * Math.PI,
          tiltSpeed: 0.05 + Math.random() * 0.08,
          shape: shapes[Math.floor(Math.random() * shapes.length)],
          opacity: 1,
          decay: 0.006 + Math.random() * 0.007,
        });
      }
    };

    // Canhão esquerdo, direito e explosão central superior
    createWave(width * 0.15, height * 0.65, 40, Math.PI * 0.45, -Math.PI * 0.35);
    createWave(width * 0.85, height * 0.65, 40, Math.PI * 0.45, -Math.PI * 0.65);
    createWave(width * 0.5, height * 0.35, 35, Math.PI * 0.85, -Math.PI * 0.5);

    let rafId = 0;

    const render = () => {
      ctx.clearRect(0, 0, width, height);

      let activeCount = 0;
      for (const p of particles) {
        if (p.opacity <= 0.02 || p.y > height + 40) continue;
        activeCount++;

        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.vy = p.vy * 0.985 + 0.32; // gravidade suave
        p.rotation += p.rotationSpeed;
        p.tiltAngle += p.tiltSpeed;
        p.tilt = Math.sin(p.tiltAngle) * 12;
        p.opacity = Math.max(0, p.opacity - p.decay);

        ctx.save();
        ctx.globalAlpha = p.opacity;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;

        const scaleY = Math.cos(p.tiltAngle);
        ctx.scale(1, Math.max(0.25, Math.abs(scaleY)));

        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === 'ribbon') {
          ctx.fillRect(-p.size * 0.9, -p.size * 0.28, p.size * 1.8, p.size * 0.56);
        } else {
          ctx.fillRect(-p.size * 0.5, -p.size * 0.5, p.size, p.size * 0.8);
        }

        ctx.restore();
      }

      if (activeCount > 0) {
        rafId = window.requestAnimationFrame(render);
      }
    };

    rafId = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', handleResize);
    };
  }, [theme]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 95,
      }}
    />
  );
}
