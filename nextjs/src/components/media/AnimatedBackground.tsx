'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/icons/Icons';
import { cx } from '@/lib/cx';
import styles from './AnimatedBackground.module.css';

export interface AnimatedBackgroundProps {
  /**
   * Modo desejado:
   * - `'canvas'` (padrão): animação geométrica em Canvas 2D na paleta Codex.
   * - `'video'`: reproduz `videoSrc` (`.mp4`/`.webm`) em loop silencioso; se
   *   falhar ou estiver ausente, cai automaticamente no Canvas 2D.
   */
  mode?: 'canvas' | 'video';
  /** Caminho do vídeo (ex.: `/backgrounds/sala.mp4`). */
  videoSrc?: string | null;
  /** Imagem estática exibida antes do vídeo carregar ou quando pausado. */
  posterSrc?: string;
  /** Intensidade da camada translúcida sobre o fundo para garantir contraste. */
  scrim?: 'subtle' | 'medium' | 'none';
  /** Exibe botão discreto de pausar/retomar no canto inferior direito. */
  showToggle?: boolean;
}

const PAUSE_STORAGE_KEY = 'codex:bg-motion-paused';

type ShapeKind = 'circle' | 'triangle' | 'diamond' | 'square' | 'plus';

interface AmbientOrb {
  xFrac: number;
  yFrac: number;
  radiusFrac: number;
  colorIndex: number;
  driftX: number;
  driftY: number;
  phase: number;
  speed: number;
}

interface FloatingShape {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotationSpeed: number;
  wobbleAmp: number;
  wobbleSpeed: number;
  wobblePhase: number;
  kind: ShapeKind;
  colorIndex: number;
  opacity: number;
  filled: boolean;
  depth: number;
}

const LIGHT_PALETTE = ['#2f6fed'];
const DARK_PALETTE = ['#4c85fb'];

const ORBS: AmbientOrb[] = [
  { xFrac: 0.16, yFrac: 0.22, radiusFrac: 0.34, colorIndex: 0, driftX: 28, driftY: 20, phase: 0.3, speed: 0.32 },
  { xFrac: 0.84, yFrac: 0.26, radiusFrac: 0.32, colorIndex: 1, driftX: 24, driftY: 26, phase: 1.8, speed: 0.27 },
  { xFrac: 0.24, yFrac: 0.82, radiusFrac: 0.3, colorIndex: 2, driftX: 22, driftY: 18, phase: 3.1, speed: 0.25 },
  { xFrac: 0.78, yFrac: 0.78, radiusFrac: 0.32, colorIndex: 3, driftX: 26, driftY: 22, phase: 4.5, speed: 0.3 },
];

/** Gerador determinístico simples para layout consistente no primeiro frame. */
function seededRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function createShapes(width: number, height: number): FloatingShape[] {
  const rand = seededRandom(20261124);
  const count = Math.max(24, Math.min(48, Math.round((width * height) / 36000)));
  const kinds: ShapeKind[] = ['circle', 'triangle', 'diamond', 'square', 'plus'];
  const shapes: FloatingShape[] = [];

  for (let i = 0; i < count; i++) {
    const depth = 0.4 + rand() * 0.85;
    const angle = rand() * Math.PI * 2;
    const speed = (6 + rand() * 11) * depth;
    const kind = kinds[i % kinds.length];

    shapes.push({
      x: rand() * width,
      y: rand() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: (14 + rand() * 24) * depth,
      rotation: rand() * Math.PI * 2,
      rotationSpeed: (rand() - 0.5) * 0.35,
      wobbleAmp: 6 + rand() * 12,
      wobbleSpeed: 0.4 + rand() * 0.5,
      wobblePhase: rand() * Math.PI * 2,
      kind,
      colorIndex: Math.floor(rand() * LIGHT_PALETTE.length),
      opacity: 0.1 + rand() * 0.12,
      filled: kind !== 'plus' && rand() > 0.35,
      depth,
    });
  }

  return shapes;
}

function detectDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

function drawRoundedTriangle(ctx: CanvasRenderingContext2D, size: number) {
  const h = size * 0.92;
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.62);
  ctx.lineTo(size * 0.58, h * 0.42);
  ctx.lineTo(-size * 0.58, h * 0.42);
  ctx.closePath();
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, w: number, h: number, r: number) {
  const x = -w / 2;
  const y = -h / 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawShape(ctx: CanvasRenderingContext2D, shape: FloatingShape, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, shape.size * 0.12);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (shape.kind) {
    case 'circle':
      ctx.beginPath();
      ctx.arc(0, 0, shape.size * 0.5, 0, Math.PI * 2);
      if (shape.filled) ctx.fill();
      else ctx.stroke();
      break;
    case 'triangle':
      drawRoundedTriangle(ctx, shape.size);
      if (shape.filled) ctx.fill();
      else ctx.stroke();
      break;
    case 'diamond':
      ctx.rotate(Math.PI / 4);
      drawRoundedRect(ctx, shape.size * 0.72, shape.size * 0.72, shape.size * 0.14);
      if (shape.filled) ctx.fill();
      else ctx.stroke();
      break;
    case 'square':
      drawRoundedRect(ctx, shape.size * 0.82, shape.size * 0.82, shape.size * 0.22);
      if (shape.filled) ctx.fill();
      else ctx.stroke();
      break;
    case 'plus': {
      const arm = shape.size * 0.42;
      ctx.beginPath();
      ctx.moveTo(-arm, 0);
      ctx.lineTo(arm, 0);
      ctx.moveTo(0, -arm);
      ctx.lineTo(0, arm);
      ctx.stroke();
      break;
    }
  }

  ctx.restore();
}

/**
 * Fundo animado reutilizável com suporte a Canvas 2D (padrão) e vídeo MP4/WebM.
 *
 * - Quando `mode="video"` e `videoSrc` é fornecido, renderiza `<video>` em loop
 *   silencioso; se houver erro de carregamento/reprodução, cai automaticamente
 *   para o Canvas 2D.
 * - Respeita `prefers-reduced-motion`, pausa quando a aba fica oculta e oferece
 *   botão discreto de pausar/retomar persistido em `localStorage`.
 */
export function AnimatedBackground({
  mode = 'canvas',
  videoSrc = null,
  posterSrc,
  scrim = 'subtle',
  showToggle = true,
}: AnimatedBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [videoFailed, setVideoFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [tabHidden, setTabHidden] = useState(false);
  const [mounted, setMounted] = useState(false);

  const useVideo = mode === 'video' && Boolean(videoSrc) && !videoFailed;
  const effectivelyPaused = paused || tabHidden;

  // Reset fallback se `videoSrc` mudar.
  useEffect(() => {
    setVideoFailed(false);
  }, [videoSrc]);

  // Lê preferência salva ou `prefers-reduced-motion` após hidratação.
  useEffect(() => {
    setMounted(true);
    let initialPaused = false;
    try {
      const stored = window.localStorage.getItem(PAUSE_STORAGE_KEY);
      if (stored === 'true') initialPaused = true;
      else if (stored === 'false') initialPaused = false;
      else {
        initialPaused = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      }
    } catch {
      initialPaused = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    }
    setPaused(initialPaused);

    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onReducedChange = (event: MediaQueryListEvent) => {
      try {
        if (window.localStorage.getItem(PAUSE_STORAGE_KEY) !== null) return;
      } catch {
        // segue com a preferência do sistema
      }
      setPaused(event.matches);
    };
    media?.addEventListener?.('change', onReducedChange);

    const onVisibility = () => setTabHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    onVisibility();

    return () => {
      media?.removeEventListener?.('change', onReducedChange);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const togglePaused = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(PAUSE_STORAGE_KEY, String(next));
      } catch {
        // storage indisponível
      }
      return next;
    });
  }, []);

  // Controla play/pause do vídeo quando em modo vídeo.
  useEffect(() => {
    if (!useVideo) return;
    const video = videoRef.current;
    if (!video) return;

    if (effectivelyPaused) {
      video.pause();
    } else {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(() => {
          // Alguns navegadores bloqueiam autoplay se houver política restritiva;
          // se o vídeo não conseguir rodar, cai de forma suave para o Canvas.
          setVideoFailed(true);
        });
      }
    }
  }, [useVideo, effectivelyPaused]);

  // Loop de renderização do Canvas 2D.
  useEffect(() => {
    if (useVideo || typeof window === 'undefined') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let dark = detectDarkTheme();
    let shapes = createShapes(width, height);

    const pointer = { targetX: 0, targetY: 0, x: 0, y: 0 };
    const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      shapes = createShapes(width, height);
    };

    resize();

    const drawFrame = (elapsedSec: number) => {
      ctx.clearRect(0, 0, width, height);
      const palette = dark ? DARK_PALETTE : LIGHT_PALETTE;
      const maxDim = Math.max(width, height);

      // 1. Orbes difusos de ambiente
      for (const orb of ORBS) {
        const cx =
          orb.xFrac * width +
          Math.sin(elapsedSec * orb.speed + orb.phase) * orb.driftX +
          pointer.x * 14;
        const cy =
          orb.yFrac * height +
          Math.cos(elapsedSec * orb.speed * 0.85 + orb.phase) * orb.driftY +
          pointer.y * 14;
        const radius = orb.radiusFrac * maxDim;

        const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        const baseColor = palette[orb.colorIndex % palette.length];
        gradient.addColorStop(0, dark ? `${baseColor}29` : `${baseColor}1f`);
        gradient.addColorStop(0.55, dark ? `${baseColor}0e` : `${baseColor}0a`);
        gradient.addColorStop(1, `${baseColor}00`);

        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 2. Formas geométricas flutuantes na paleta Codex
      for (const shape of shapes) {
        const wobbleX = Math.sin(elapsedSec * shape.wobbleSpeed + shape.wobblePhase) * shape.wobbleAmp;
        const wobbleY =
          Math.cos(elapsedSec * shape.wobbleSpeed * 0.9 + shape.wobblePhase) * shape.wobbleAmp;
        const parallaxX = pointer.x * 22 * shape.depth;
        const parallaxY = pointer.y * 22 * shape.depth;

        ctx.save();
        ctx.translate(shape.x + wobbleX + parallaxX, shape.y + wobbleY + parallaxY);
        ctx.rotate(shape.rotation);

        const color = palette[shape.colorIndex % palette.length];
        const alpha = dark ? shape.opacity * 1.15 : shape.opacity;
        drawShape(ctx, shape, color, alpha);
        ctx.restore();
      }
    };

    // Desenha imediatamente o primeiro frame (garante fundo composto mesmo se pausado).
    let elapsedSec = 0;
    drawFrame(elapsedSec);

    const onResize = () => {
      resize();
      drawFrame(elapsedSec);
    };
    window.addEventListener('resize', onResize);

    const onPointerMove = (event: PointerEvent) => {
      if (isCoarsePointer) return;
      pointer.targetX = (event.clientX / Math.max(1, width) - 0.5) * 2;
      pointer.targetY = (event.clientY / Math.max(1, height) - 0.5) * 2;
    };
    if (!isCoarsePointer) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
    }

    const themeObserver = new MutationObserver(() => {
      const nextDark = detectDarkTheme();
      if (nextDark !== dark) {
        dark = nextDark;
        drawFrame(elapsedSec);
      }
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const colorSchemeMedia = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onSchemeChange = () => {
      dark = detectDarkTheme();
      drawFrame(elapsedSec);
    };
    colorSchemeMedia?.addEventListener?.('change', onSchemeChange);

    if (effectivelyPaused) {
      return () => {
        window.removeEventListener('resize', onResize);
        if (!isCoarsePointer) window.removeEventListener('pointermove', onPointerMove);
        themeObserver.disconnect();
        colorSchemeMedia?.removeEventListener?.('change', onSchemeChange);
      };
    }

    let rafId = 0;
    let lastTime = performance.now();
    const margin = 48;

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
      lastTime = now;
      elapsedSec += dt;

      // Interpolação suave do paralaxe do ponteiro
      pointer.x += (pointer.targetX - pointer.x) * Math.min(1, dt * 3.5);
      pointer.y += (pointer.targetY - pointer.y) * Math.min(1, dt * 3.5);

      for (const shape of shapes) {
        shape.x += shape.vx * dt;
        shape.y += shape.vy * dt;
        shape.rotation += shape.rotationSpeed * dt;

        if (shape.x < -margin) shape.x = width + margin;
        else if (shape.x > width + margin) shape.x = -margin;
        if (shape.y < -margin) shape.y = height + margin;
        else if (shape.y > height + margin) shape.y = -margin;
      }

      drawFrame(elapsedSec);
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      if (!isCoarsePointer) window.removeEventListener('pointermove', onPointerMove);
      themeObserver.disconnect();
      colorSchemeMedia?.removeEventListener?.('change', onSchemeChange);
    };
  }, [useVideo, effectivelyPaused]);

  return (
    <>
      <div className={styles.backdrop} aria-hidden="true">
        {useVideo && videoSrc ? (
          <video
            ref={videoRef}
            className={styles.video}
            src={videoSrc}
            poster={posterSrc}
            autoPlay={!effectivelyPaused}
            loop
            muted
            playsInline
            preload="metadata"
            onError={() => setVideoFailed(true)}
          />
        ) : (
          <canvas ref={canvasRef} className={styles.canvas} />
        )}

        {scrim !== 'none' && (
          <div className={cx(styles.scrim, scrim === 'medium' && styles.scrimMedium)} />
        )}
      </div>

      {showToggle && mounted && (
        <button
          type="button"
          className={styles.toggle}
          onClick={togglePaused}
          aria-pressed={paused}
          aria-label={paused ? 'Retomar animação de fundo' : 'Pausar animação de fundo'}
          title={paused ? 'Retomar animação de fundo' : 'Pausar animação de fundo'}
        >
          {paused ? <Icon.Play size={15} /> : <Icon.Pause size={15} />}
          <span>{paused ? 'Animar fundo' : 'Pausar fundo'}</span>
        </button>
      )}
    </>
  );
}
