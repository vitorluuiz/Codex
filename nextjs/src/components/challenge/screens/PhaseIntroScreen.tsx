'use client';

import { useEffect, useRef, useState } from 'react';

import { Icon } from '@/components/icons/Icons';
import { soundEffects } from '@/lib/audio/soundEffects';
import type { Phase, PhaseKind } from '@/lib/types';
import { useRealtime } from '@/realtime/RealtimeProvider';
import styles from './PhaseIntroScreen.module.css';

interface PhaseIntroScreenProps {
  phase: Phase;
  phaseNumber: number;
  totalPhases: number;
  startsAt: number | null;
  onComplete: () => void;
}

const DEFAULT_INTRO_SECONDS = 5;
const RADIUS = 70;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const KIND_LABELS: Record<PhaseKind, string> = {
  quiz: 'Quiz',
  code: 'Código',
  text: 'Dissertativa',
  fill: 'Completar frase',
};

function getPhaseTitle(phase: Phase): string {
  if (phase.kind === 'quiz' || phase.kind === 'text') {
    return phase.question || phase.name;
  }
  if (phase.kind === 'code') {
    return phase.title || phase.name;
  }
  if (phase.kind === 'fill') {
    const text = phase.segments
      .map((s) => (s.type === 'text' ? s.value : '___'))
      .join(' ');
    return text.trim() || phase.name || 'Complete as lacunas';
  }
  return 'Novo Desafio';
}

/**
 * Tela de pré-desafio animada no início da fase (estilo Kahoot).
 * Sincronizada com o relógio do servidor via `startsAt` e `clockOffset`,
 * respeitando `introSeconds`, `introTip`, `introSound`, `introShapes` e `theme`.
 */
export function PhaseIntroScreen({
  phase,
  phaseNumber,
  totalPhases,
  startsAt,
  onComplete,
}: PhaseIntroScreenProps) {
  const { clockOffset } = useRealtime();

  const introSeconds = Math.max(1, phase.introSeconds ?? DEFAULT_INTRO_SECONDS);
  const introTotalMs = introSeconds * 1000;
  const soundEnabled = phase.introSound ?? true;
  const showShapes = phase.introShapes ?? true;
  const introTip = phase.introTip?.trim() || '';
  const theme = phase.theme || 'default';
  const points = Math.round(phase.basePoints * phase.pointsMultiplier);

  // Se startsAt não veio, assume introTotalMs a partir do momento atual sincronizado
  const targetTimeRef = useRef<number>(
    startsAt ?? Date.now() + clockOffset + introTotalMs,
  );

  useEffect(() => {
    if (startsAt !== null) {
      targetTimeRef.current = startsAt;
    }
  }, [startsAt]);

  const [remainingMs, setRemainingMs] = useState<number>(() => {
    const now = Date.now() + clockOffset;
    return Math.max(0, targetTimeRef.current - now);
  });

  const [isExiting, setIsExiting] = useState(false);
  const [muted, setMuted] = useState(() => soundEffects.isMuted());

  const lastPlayedSecondRef = useRef<number | null>(null);
  const completedRef = useRef(false);

  // Escuta alterações externas no status de áudio
  useEffect(() => {
    return soundEffects.onMuteChange(setMuted);
  }, []);

  // Loop de alta resolução do cronômetro sincronizado
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now() + clockOffset;
      const left = Math.max(0, targetTimeRef.current - now);
      setRemainingMs(left);

      const currentSecond = Math.ceil(left / 1000);

      // Toca o bip a cada segundo decrementado quando o som da intro está ativo
      if (soundEnabled && currentSecond > 0 && currentSecond !== lastPlayedSecondRef.current) {
        lastPlayedSecondRef.current = currentSecond;
        soundEffects.playTick(currentSecond);
      }

      // Ao zerar a contagem regressiva
      if (left <= 0 && !completedRef.current) {
        completedRef.current = true;
        clearInterval(interval);
        if (soundEnabled) {
          soundEffects.playGo();
        }
        setIsExiting(true);

        const exitTimeout = setTimeout(() => {
          onComplete();
        }, 320);

        return () => clearTimeout(exitTimeout);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [clockOffset, onComplete, soundEnabled]);

  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));

  // Cálculo da barra circular de progresso (0% a 100%)
  const fraction = Math.max(0, Math.min(1, remainingMs / introTotalMs));
  const strokeDashoffset = CIRCUMFERENCE * (1 - fraction);

  return (
    <div
      className={`${styles.screen} ${isExiting ? styles.screenExit : ''}`}
      data-phase-theme={theme}
      role="region"
      aria-label="Preparação para a fase"
    >
      {/* Formas geométricas flutuantes de fundo */}
      {showShapes && (
        <div className={styles.shapes} aria-hidden>
          <div className={`${styles.shape} ${styles.triangle1}`} />
          <div className={`${styles.shape} ${styles.diamond1}`} />
          <div className={`${styles.shape} ${styles.circle1}`} />
          <div className={`${styles.shape} ${styles.square1}`} />
          <div className={`${styles.shape} ${styles.triangle2}`} />
          <div className={`${styles.shape} ${styles.circle2}`} />
        </div>
      )}

      {/* Barra Superior com Contador de Fase e Controle de Som */}
      <header className={styles.topBar}>
        <div className={styles.topMeta}>
          <div className={styles.phaseBadge}>
            <Icon.Sparkle size={18} />
            <span>
              Fase {phaseNumber} de {totalPhases}
            </span>
          </div>
          <span className={styles.metaPill}>{KIND_LABELS[phase.kind]}</span>
          <span className={styles.metaPill}>Vale {points} pts</span>
        </div>

        {soundEnabled && (
          <button
            type="button"
            className={styles.audioButton}
            onClick={() => soundEffects.toggleMute()}
            aria-label={muted ? 'Ativar efeitos sonoros' : 'Silenciar efeitos sonoros'}
            title={muted ? 'Efeitos sonoros desativados' : 'Efeitos sonoros ativados'}
          >
            {muted ? <Icon.VolumeMuted size={18} /> : <Icon.Volume size={18} />}
            <span>{muted ? 'Mudo' : 'Som'}</span>
          </button>
        )}
      </header>

      {/* Conteúdo Central */}
      <main className={styles.centerCard}>
        <span className={styles.phaseTag}>{phase.name || 'Prepare-se!'}</span>
        <h1 className={styles.title}>{getPhaseTitle(phase)}</h1>

        <div className={styles.timerContainer}>
          <svg className={styles.timerSvg} viewBox="0 0 160 160">
            <circle
              className={styles.timerTrack}
              cx="80"
              cy="80"
              r={RADIUS}
              fill="none"
              strokeWidth="8"
            />
            <circle
              className={styles.timerProgress}
              cx="80"
              cy="80"
              r={RADIUS}
              fill="none"
              strokeWidth="8"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
            />
          </svg>

          <div className={styles.numberWrapper}>
            <span key={seconds} className={styles.countdownNumber}>
              {seconds > 0 ? seconds : 1}
            </span>
          </div>
        </div>

        {introTip ? (
          <div className={styles.tipBanner}>
            <Icon.Sparkle size={18} className={styles.tipIcon} />
            <span>{introTip}</span>
          </div>
        ) : (
          <p className={styles.subtitle}>O desafio começará em instantes...</p>
        )}
      </main>

      {/* Rodapé informativo */}
      <footer className={styles.footerNotice}>
        Fique atento à tela — você terá {phase.timeSeconds}s assim que a contagem terminar.
      </footer>
    </div>
  );
}
