/**
 * Sintetizador de efeitos sonoros nativo com Web Audio API.
 *
 * Não carrega arquivos externos na rede — gera bips e fanfarras cristalinas
 * com latência zero diretamente no hardware de áudio do dispositivo.
 */

const STORAGE_KEY = 'codex_sfx_muted';
const EVENT_NAME = 'codex_sfx_change';

class SoundEffectsController {
  private ctx: AudioContext | null = null;
  private muted: boolean = false;

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        this.muted = localStorage.getItem(STORAGE_KEY) === 'true';
      } catch {
        this.muted = false;
      }
    }
  }

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, String(muted));
        window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { muted } }));
      } catch {}
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public onMuteChange(callback: (muted: boolean) => void): () => void {
    if (typeof window === 'undefined') return () => {};
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ muted: boolean }>).detail;
      callback(detail?.muted ?? this.muted);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }

  /**
   * Bip curto para a contagem regressiva (5... 4... 3... 2... 1...).
   * O tom sobe ligeiramente nos últimos 3 segundos para criar expectativa.
   */
  public playTick(count: number): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      // Frequência varia de 520Hz (5 e 4) a 680Hz (3, 2, 1)
      const freq = count <= 3 ? 680 : 520;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.09);
    } catch {}
  }

  /**
   * Fanfarra/acorde triunfante para o instante "GO!" (0s), quando o desafio abre.
   */
  public playGo(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      // Arpeggio rápido: Dó5 (523Hz) -> Mi5 (659Hz) -> Sol5 (784Hz) -> Dó6 (1046Hz)
      const notes = [523.25, 659.25, 783.99, 1046.5];

      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + index * 0.06;

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.22, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.35);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.36);
      });
    } catch {}
  }

  /**
   * Acorde celebratório quando o participante acerta o desafio (acompanha os confetes).
   */
  public playSuccess(): void {
    if (this.muted) return;
    const ctx = this.getContext();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const notes = [587.33, 739.99, 880, 1174.66]; // Ré maior brilhante (D5 -> F#5 -> A5 -> D6)

      notes.forEach((freq, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = now + index * 0.055;

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);

        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.42);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.44);
      });
    } catch {}
  }
}

export const soundEffects = new SoundEffectsController();
