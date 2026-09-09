/**
 * Modelo de domínio do Codex.
 *
 * Este arquivo é o contrato: `contracts/api/api-rest-contract.md` e
 * `contracts/realtime/websocket-contract.md` descrevem exatamente estes formatos. Nada
 * aqui é dado de exemplo — são só os tipos que a API precisa devolver para a
 * interface conseguir se montar.
 */

/* -------------------------------------------------------------------------- */
/* Identidade                                                                  */
/* -------------------------------------------------------------------------- */

/** Índice na paleta de avatares (0..5). Ver `src/components/avatar/avatars.tsx`. */
export type AvatarIndex = 0 | 1 | 2 | 3 | 4 | 5;

export type PlanId = 'free' | 'intermediate' | 'pro';

/**
 * Para quem a pessoa cria partidas. Muda o vocabulário da interface
 * ("Participantes" vira "Candidatos"), não as permissões.
 */
export type Audience = 'teacher' | 'recruiter';

/** Provedores de login social do contrato (api-rest.md secao 2). */
export type OAuthProvider = 'google' | 'microsoft' | 'github';

export interface User {
  id: string;
  name: string;
  email: string;
  avatarIndex: AvatarIndex;
  plan: PlanId;
  audience: Audience;
}

/** Sessão resolvida no servidor a partir do cookie. */
export interface Session {
  user: User | null;
  /** Presente quando a pessoa entrou numa sala como convidado. */
  participantId: string | null;
  roomCode: string | null;
}

/* -------------------------------------------------------------------------- */
/* Sala e participantes                                                        */
/* -------------------------------------------------------------------------- */

export type RoomStatus = 'lobby' | 'running' | 'finished';
export type MatchMode = 'live' | 'self-paced';

export interface Room {
  id: string;
  /** Código de 6 dígitos digitado pelo aluno. */
  code: string;
  status: RoomStatus;
  matchMode: MatchMode | null;
  capacity: number;
  locked: boolean;
  requireAccount: boolean;
  leader: { id: string; name: string };
  createdAt: string;
}

/** Em que papel a pessoa está numa sala. Derivado de `leader.id`, não é uma coluna. */
export type RoomMembershipRole = 'leader' | 'participant';

/**
 * Uma sala que ainda está de pé e da qual a pessoa faz parte — o que "Voltar para
 * a sala" precisa saber (`GET /rooms/active`).
 *
 * Fechar a aba não tira ninguém da sala, então esta lista é o caminho de volta:
 * o líder a vê no histórico do perfil, e qualquer um a vê na tela de entrar sem
 * ter que digitar o código de novo.
 *
 * `setTitle` e `phaseCount` só vêm para `role: 'leader'`: a fila é o roteiro da
 * aula e `GET /rooms/{code}/queue` é rota de líder — o resumo aqui não pode
 * contornar isso.
 */
export interface ActiveRoom {
  code: string;
  status: RoomStatus;
  matchMode: MatchMode | null;
  role: RoomMembershipRole;
  leaderName: string;
  setTitle: string | null;
  phaseCount: number | null;
  participantCount: number;
  /** Já formatado pelo servidor. Ex.: "28 jul 2026 · 14:32". */
  createdAtLabel: string;
}

export type ParticipantStatus = 'pending' | 'approved' | 'rejected' | 'removed';

export interface Participant {
  id: string;
  roomId: string;
  displayName: string;
  avatarIndex: AvatarIndex;
  /** `true` quando entrou autenticado; `false` para convidado. */
  loggedIn: boolean;
  userId: string | null;
  status: ParticipantStatus;
  joinedAt: string;
  /**
   * `true` enquanto a pessoa está na tela de resultados da última partida e ainda
   * não voltou ao lobby. Encerrar a partida não arrasta mais ninguém de volta — cada
   * um sai do pódio quando quiser —, então o lobby marca quem ainda não voltou.
   *
   * Quem está assim **não conta como jogador**: fica fora do `totalPlayers` e da
   * regra "todos enviaram" da próxima partida.
   */
  inResults: boolean;
}

/** Motivos de recusa na entrada — cada um vira um diálogo próprio na UI. */
export type JoinRejectionReason =
  | 'not_found'
  | 'locked'
  | 'account_required'
  | 'username_taken'
  | 'full'
  | 'network';

/* -------------------------------------------------------------------------- */
/* Conjuntos e fases                                                           */
/* -------------------------------------------------------------------------- */

export type PhaseKind = 'quiz' | 'code' | 'text' | 'fill';

export interface PhaseSetSummary {
  id: string;
  title: string;
  phaseCount: number;
  /** `owned` = criado pelo líder; `community` = publicado por outra pessoa. */
  source: 'owned' | 'community';
  /** Preenchido em `owned`. Ex.: "editado há 2 dias". */
  updatedLabel: string | null;
  /** Preenchido em `community`. */
  authorName: string | null;
}

interface PhaseBase {
  id: string;
  setId: string;
  name: string;
  basePoints: number;
  pointsMultiplier: number;
  timeSeconds: number;
}

export interface QuizOption {
  id: string;
  label: string;
}

export interface QuizPhase extends PhaseBase {
  kind: 'quiz';
  question: string;
  options: QuizOption[];
  /** Só é enviado ao líder ou depois do fim da fase. */
  correctOptionId?: string;
  explanation?: string;
}

export interface CodeExample {
  input: string;
  output: string;
}

export interface CodeLanguage {
  id: string;
  label: string;
  /** Linguagens ainda não suportadas aparecem desabilitadas ("Em breve"). */
  enabled: boolean;
  starterCode: string;
}

export interface CodePhase extends PhaseBase {
  kind: 'code';
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  tags: string[];
  /** Enunciado em Markdown reduzido (só `código inline` é interpretado). */
  statement: string;
  examples: CodeExample[];
  languages: CodeLanguage[];
  fileName: string;
}

export interface TextPhase extends PhaseBase {
  kind: 'text';
  question: string;
  placeholder?: string;
  /** Visível apenas para o líder. */
  expectedAnswer?: string;
}

/** Um trecho da frase: texto fixo ou uma lacuna a preencher. */
export type FillSegment =
  | { type: 'text'; value: string }
  | { type: 'blank'; index: number };

export interface FillPhase extends PhaseBase {
  kind: 'fill';
  segments: FillSegment[];
  /** Banco de palavras oferecido ao aluno. */
  words: string[];
  /** Só é enviado ao líder ou depois do fim da fase. */
  correctWords?: string[];
  explanation?: string;
}

export type Phase = QuizPhase | CodePhase | TextPhase | FillPhase;

/* -------------------------------------------------------------------------- */
/* Autoria de conjuntos                                                        */
/* -------------------------------------------------------------------------- */

/**
 * O editor trabalha com uma forma diferente da que a partida consome.
 *
 * `Phase` é o que o jogador recebe: gabarito escondido, frase já quebrada em
 * segmentos, linguagens resolvidas. `DraftPhase` é o que o autor digita: o
 * gabarito é o próprio conteúdo, a frase é texto com `___`, e nada foi
 * normalizado ainda. O servidor converte um no outro ao salvar — misturar os
 * dois faria o editor ter que desmontar e remontar a fase a cada tecla.
 */
interface DraftPhaseBase {
  id: string;
  name: string;
  basePoints: number;
  pointsMultiplier: number;
  timeSeconds: number;
  /** Enunciado. Em `fill`, usa `___` (ou `PALAVRA`) para marcar cada lacuna. */
  question: string;
  /** `true` enquanto o texto veio da IA e o autor não revisou. */
  fromAI: boolean;
}

export interface QuizDraftPhase extends DraftPhaseBase {
  kind: 'quiz';
  options: string[];
  /** Índices em `options`. Nunca vazio e nunca todas as alternativas. */
  correctIndexes: number[];
}

export interface CodeDraftPhase extends DraftPhaseBase {
  kind: 'code';
  starterCode: string;
  /** Casos de teste em texto livre — o servidor é quem interpreta o formato. */
  testCases: string;
}

export interface TextDraftPhase extends DraftPhaseBase {
  kind: 'text';
  /** Referência para a correção por IA. */
  expectedAnswer: string;
}

export interface FillDraftPhase extends DraftPhaseBase {
  kind: 'fill';
  /** Banco de palavras oferecido ao aluno, incluindo as distratoras. */
  words: string[];
  /** Gabarito posicional: uma entrada por lacuna de `question`. */
  blanks: (string | null)[];
}

export type DraftPhase = QuizDraftPhase | CodeDraftPhase | TextDraftPhase | FillDraftPhase;

export interface PhaseSetDraft {
  /** `null` num conjunto que ainda não foi salvo pela primeira vez. */
  id: string | null;
  title: string;
  phases: DraftPhase[];
}

/** Dificuldade pedida na geração por IA. */
export type AiDifficulty = 'easy' | 'medium' | 'hard';

export interface AiPhaseRequest {
  kind: PhaseKind;
  topic: string;
  difficulty: AiDifficulty;
  /** Instruções adicionais do autor. Opcional. */
  notes: string;
}

/* -------------------------------------------------------------------------- */
/* Partida                                                                     */
/* -------------------------------------------------------------------------- */

export interface Match {
  id: string;
  roomId: string;
  mode: MatchMode;
  status: 'running' | 'paused' | 'finished';
  currentPhaseIndex: number;
  totalPhases: number;
  startedAt: string;
}

/** Estado da fase em andamento, do ponto de vista de quem pediu. */
export interface PhaseState {
  phase: Phase;
  /** Posição 1-based, usada em "Fase 3 de 8". */
  phaseNumber: number;
  totalPhases: number;
  /** Segundos restantes no instante da resposta; o cliente conta a partir daí. */
  secondsLeft: number;
  paused: boolean;
  submittedCount: number;
  totalPlayers: number;
  /** Submissão da própria pessoa, se já tiver enviado. */
  mySubmission: Submission | null;
}

/* -------------------------------------------------------------------------- */
/* Respostas                                                                   */
/* -------------------------------------------------------------------------- */

export type AnswerPayload =
  | { kind: 'quiz'; optionId: string }
  | { kind: 'code'; languageId: string; source: string }
  | { kind: 'text'; value: string }
  | { kind: 'fill'; blanks: (string | null)[] };

export type GradingStatus = 'pending' | 'graded';

export interface AiSuggestion {
  title: string;
  body: string;
}

export interface Submission {
  id: string;
  phaseId: string;
  participantId: string;
  answer: AnswerPayload;
  submittedAt: string;
  elapsedSeconds: number;
  grading: GradingStatus;
  /** Nulo enquanto `grading === 'pending'`. */
  correct: boolean | null;
  score: number | null;
  /** Texto de "Por que essa é a resposta certa" / feedback da IA. */
  explanation: string | null;
  /** Só em fases de código. */
  aiSuggestions: AiSuggestion[] | null;
  /** Só em fases de código. */
  testsPassed: { passed: number; total: number } | null;
}

export interface CodeRunResult {
  status: 'success' | 'error';
  output: string;
  testsPassed: { passed: number; total: number } | null;
}

/* -------------------------------------------------------------------------- */
/* Métricas do líder                                                           */
/* -------------------------------------------------------------------------- */

export interface AnswerDistributionEntry {
  optionId: string;
  label: string;
  count: number;
  correct: boolean;
}

export interface GradingDistributionEntry {
  status: 'correct' | 'incorrect' | 'awaiting';
  count: number;
}

export interface ResponseTimeBucket {
  /** Ex.: "0-15s". */
  label: string;
  count: number;
}

export interface LeaderPlayerRow {
  participantId: string;
  name: string;
  avatarIndex: AvatarIndex;
  status: 'submitted' | 'pending';
  elapsedSeconds: number | null;
  correct: boolean | null;
}

export interface PhaseStats {
  phaseId: string;
  submittedCount: number;
  totalPlayers: number;
  readyCount: number;
  accuracyRate: number;
  correctCount: number;
  gradedCount: number;
  avgResponseSeconds: number;
  fastestResponseSeconds: number;
  teamAvgScore: number;
  teamTopScore: number;
  answerDistribution: AnswerDistributionEntry[];
  gradingDistribution: GradingDistributionEntry[];
  responseTimeBuckets: ResponseTimeBucket[];
  players: LeaderPlayerRow[];
}

/* -------------------------------------------------------------------------- */
/* Comparação com a turma e pódio                                              */
/* -------------------------------------------------------------------------- */

export interface PhaseComparison {
  myScore: number;
  phaseScore: number;
  /** "Top 91%" — percentual de jogadores que a pessoa superou. */
  percentile: number;
  /** Histograma de pontuação da turma nesta fase, já ordenado. */
  histogram: { score: number; isMe: boolean }[];
  correctAnswerLabel: string | null;
  correct: boolean | null;
}

export interface PodiumEntry {
  participantId: string;
  name: string;
  score: number;
  avatarUrl: string | null;
  avatarIndex: AvatarIndex;
}

/* -------------------------------------------------------------------------- */
/* Escopo do jogador na barra superior                                         */
/* -------------------------------------------------------------------------- */

export interface PlayerScoreboard {
  myScore: number;
  avgScore: number;
}

/* -------------------------------------------------------------------------- */
/* Perfil                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Uma partida já encerrada, do ponto de vista de quem a conduziu.
 *
 * Traz os números do relatório resumido junto porque a tela mostra os dois no
 * mesmo lugar: a linha da lista e o diálogo "Ver relatório" leem deste objeto,
 * sem uma segunda ida ao servidor.
 */
export interface LeaderMatchSummary {
  id: string;
  setTitle: string;
  mode: MatchMode;
  /** Já formatado e localizado pelo servidor. Ex.: "28 jul 2026 · 14:32". */
  playedAtLabel: string;
  participantCount: number;
  avgScore: number;
  /** 0..100. */
  accuracyRate: number;
  /** Ex.: "32 min". */
  durationLabel: string;
}

/** Payload de `GET /users/{id}/profile`. */
export interface LeaderProfile {
  user: User;
  /** Conjuntos de autoria da pessoa, mais recentes primeiro. */
  sets: PhaseSetSummary[];
  matches: LeaderMatchSummary[];
}
