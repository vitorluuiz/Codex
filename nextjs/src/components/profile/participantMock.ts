import type { PhaseKind } from '@/lib/types';

/**
 * Perfil de participante — dados de vitrine (streak, conquistas, desempenho por
 * tipo de fase, histórico de salas jogadas). Não há rota de API para isso
 * ainda, e não é um "aguardando o backend": é mock local, como
 * `set-library/mockLibrary.ts`, até o produto decidir o que dessas métricas
 * vale a pena persistir de verdade. Por isso os tipos moram aqui, fora de
 * `lib/types.ts` — aquele arquivo é o contrato com a API, este não é.
 */

export interface StreakDay {
  label: string;
  done: boolean;
}

export interface PlayerStat {
  label: string;
  value: string;
}

export interface TypeStat {
  kind: PhaseKind;
  solved: number;
  /** 0..100 */
  accuracy: number;
}

export interface PracticedEntry {
  id: string;
  title: string;
  kind: PhaseKind;
  typeLabel: string;
  dateLabel: string;
  phaseCount: number;
  score: number;
}

export interface Achievement {
  id: string;
  title: string;
  description: string;
  unlocked: boolean;
}

export interface ParticipantRoomHistoryEntry {
  id: string;
  setTitle: string;
  dateLabel: string;
  hostName: string;
  rankLabel: string;
  score: number;
  /** 0..100 */
  accuracy: number;
  phaseAccuracy: number[];
}

export interface ParticipantProfileData {
  streakDays: number;
  streakWeek: StreakDay[];
  playerStats: PlayerStat[];
  typeStats: TypeStat[];
  practicedList: PracticedEntry[];
  achievementsUnlocked: number;
  achievementsTotal: number;
  achievementsList: Achievement[];
  roomHistory: ParticipantRoomHistoryEntry[];
}

export const MOCK_PARTICIPANT_PROFILE: ParticipantProfileData = {
  streakDays: 12,
  streakWeek: [
    { label: 'D', done: true },
    { label: 'S', done: true },
    { label: 'T', done: true },
    { label: 'Q', done: true },
    { label: 'Q', done: false },
    { label: 'S', done: false },
    { label: 'S', done: false },
  ],
  playerStats: [
    { label: 'Desafios resolvidos', value: '184' },
    { label: 'Taxa de acerto', value: '76%' },
    { label: 'Pontuação total', value: '12.4k' },
    { label: 'Salas jogadas', value: '23' },
  ],
  typeStats: [
    { kind: 'quiz', solved: 62, accuracy: 81 },
    { kind: 'code', solved: 38, accuracy: 64 },
    { kind: 'text', solved: 44, accuracy: 72 },
    { kind: 'fill', solved: 40, accuracy: 88 },
  ],
  practicedList: [
    {
      id: 'p1',
      title: 'Frações & Funções Básicas',
      kind: 'quiz',
      typeLabel: 'Quiz',
      dateLabel: 'há 2 dias',
      phaseCount: 8,
      score: 640,
    },
    {
      id: 'p2',
      title: 'Estruturas de repetição',
      kind: 'code',
      typeLabel: 'Código',
      dateLabel: 'há 5 dias',
      phaseCount: 6,
      score: 410,
    },
    {
      id: 'p3',
      title: 'Interpretação de texto',
      kind: 'text',
      typeLabel: 'Dissertativa',
      dateLabel: 'há 1 semana',
      phaseCount: 5,
      score: 380,
    },
    {
      id: 'p4',
      title: 'Álgebra para o ENEM',
      kind: 'fill',
      typeLabel: 'Completar frase',
      dateLabel: 'há 2 semanas',
      phaseCount: 10,
      score: 720,
    },
  ],
  achievementsUnlocked: 6,
  achievementsTotal: 10,
  achievementsList: [
    { id: 'a1', title: 'Primeira partida', description: 'Jogou sua primeira sala.', unlocked: true },
    { id: 'a2', title: '10 dias seguidos', description: 'Praticou 10 dias sem parar.', unlocked: true },
    { id: 'a3', title: 'Acerto perfeito', description: '100% de acerto numa partida.', unlocked: true },
    {
      id: 'a4',
      title: 'Maratonista',
      description: 'Resolveu 100 desafios.',
      unlocked: false,
    },
  ],
  roomHistory: [
    {
      id: 'r1',
      setTitle: 'Frações & Funções Básicas',
      dateLabel: '28 jul 2026',
      hostName: 'Prof. Marina Duarte',
      rankLabel: '2º',
      score: 640,
      accuracy: 82,
      phaseAccuracy: [92, 81, 70, 65, 88, 74, 60, 95],
    },
    {
      id: 'r2',
      setTitle: 'Estruturas de repetição',
      dateLabel: '14 jul 2026',
      hostName: 'Prof. Carlos Lima',
      rankLabel: '1º',
      score: 410,
      accuracy: 90,
      phaseAccuracy: [95, 88, 92, 85, 91, 87],
    },
  ],
};
