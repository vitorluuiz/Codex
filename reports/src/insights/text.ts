import { INSIGHT_THRESHOLDS } from './thresholds.js';

/**
 * Conta o número de palavras significativas em uma string.
 */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter((w) => w.length > 0).length;
}

/**
 * Estima o tempo de leitura em segundos com base na velocidade média esperada
 * para estudantes (2.5 palavras/segundo ~ 150 ppm).
 */
export function estimateReadingSeconds(totalWords: number): number {
  if (totalWords <= 0) return 1;
  return Math.max(1, Math.ceil(totalWords / INSIGHT_THRESHOLDS.reading.wordsPerSecond));
}

/**
 * Normaliza respostas textuais ou de alternativas para comparação insensível
 * a caixa, acentuação e espaços extras.
 */
export function normalizeAnswerText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}
