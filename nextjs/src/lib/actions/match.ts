'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { ApiError, apiRequest } from '@/lib/api/client';
import type {
  AnswerPayload,
  CodeRunResult,
  PhaseComparison,
  PhaseState,
  PodiumEntry,
  Submission,
} from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* Leituras sob demanda (disparadas pela UI, não no render)                     */
/* -------------------------------------------------------------------------- */

/** `GET /matches/{matchId}/phases/{phaseId}/comparison` */
export async function loadPhaseComparisonAction(
  matchId: string,
  phaseId: string,
): Promise<PhaseComparison> {
  return apiRequest<PhaseComparison>(`/matches/${matchId}/phases/${phaseId}/comparison`);
}

/** `GET /matches/{matchId}/podium` */
export async function loadPodiumAction(matchId: string): Promise<PodiumEntry[]> {
  return apiRequest<PodiumEntry[]>(`/matches/${matchId}/podium`);
}

/**
 * `GET /matches/{matchId}/current-phase`
 *
 * Chamada quando o cronômetro local chega a zero. **O efeito que importa não é a
 * resposta**: a API fecha a fase vencida na própria leitura (fechamento preguiçoso,
 * sem job) e publica `phase.ended` para a sala inteira. Sem esse cutucão, uma fase
 * cujo tempo acabou sem ninguém responder ficaria aberta para sempre — a turma
 * inteira parada esperando um evento que ninguém dispararia.
 *
 * É idempotente do lado do servidor: só o primeiro a chegar publica o evento.
 */
export async function refreshPhaseStateAction(matchId: string): Promise<PhaseState> {
  return apiRequest<PhaseState>(`/matches/${matchId}/current-phase`);
}

/**
 * `POST /rooms/{code}/participants/me/return` — o "Continuar jogando" do pódio.
 *
 * Tira a marca de "ainda nos resultados" do próprio participante, devolvendo-o à
 * lista ativa do lobby. Encerrar a partida deixou de arrastar a turma de volta: cada
 * um sai do pódio quando quiser, e é esta chamada que avisa o servidor.
 */
export async function returnToLobbyAsParticipantAction(roomCode: string) {
  await apiRequest(`/rooms/${roomCode}/participants/me/return`, { method: 'POST' });
  revalidateTag(`room:${roomCode}:participants`);
  revalidateTag(`room:${roomCode}`);
  revalidatePath(`/sala/${roomCode}/lobby`);
}

/* -------------------------------------------------------------------------- */
/* Aluno                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `POST /matches/{matchId}/phases/{phaseId}/submissions`
 *
 * A correção é do servidor: a UI nunca sabe a resposta certa antes de enviar.
 * Para `quiz`/`fill` a resposta volta já corrigida; para `text`/`code` volta com
 * `grading: 'pending'` e o resultado chega depois pelo WebSocket
 * (`submission.graded`).
 */
export async function submitAnswerAction(
  matchId: string,
  phaseId: string,
  answer: AnswerPayload,
): Promise<SubmitAnswerResult> {
  try {
    const submission = await apiRequest<Submission>(
      `/matches/${matchId}/phases/${phaseId}/submissions`,
      { method: 'POST', body: { answer } },
    );
    return { status: 'sent', submission };
  } catch (error) {
    // Traduzido aqui, e não relançado, porque `ApiError` **não sobrevive à fronteira
    // de uma Server Action**: o Next serializa a exceção e o cliente recebe um erro
    // opaco, sem `code`. Um `instanceof` do outro lado nunca seria verdadeiro.
    if (error instanceof ApiError && error.code === 'PHASE_CLOSED') {
      return { status: 'phase-closed' };
    }
    throw error;
  }
}

/**
 * Resultado de um envio.
 *
 * `phase-closed` não é falha: é o tempo tendo acabado entre a tela abrir e o clique.
 * A UI trata como "não deu tempo" e segue para o feedback, em vez de estourar um erro
 * não tratado na cara do aluno.
 */
export type SubmitAnswerResult =
  | { status: 'sent'; submission: Submission }
  | { status: 'phase-closed' };

/** `POST /matches/{matchId}/phases/{phaseId}/run` — execução de teste, não conta como envio. */
export async function runCodeAction(
  matchId: string,
  phaseId: string,
  languageId: string,
  source: string,
): Promise<CodeRunResult> {
  return apiRequest<CodeRunResult>(`/matches/${matchId}/phases/${phaseId}/run`, {
    method: 'POST',
    body: { languageId, source },
  });
}

/** `POST /matches/{matchId}/phases/{phaseId}/ready` — modo ao vivo. */
export async function markReadyAction(matchId: string, phaseId: string) {
  await apiRequest(`/matches/${matchId}/phases/${phaseId}/ready`, { method: 'POST' });
}

/* -------------------------------------------------------------------------- */
/* Líder                                                                       */
/* -------------------------------------------------------------------------- */

/** `POST /matches/{matchId}/advance` */
export async function advancePhaseAction(matchId: string, direction: 'next' | 'previous') {
  await apiRequest(`/matches/${matchId}/advance`, { method: 'POST', body: { direction } });
}

/** `POST /matches/{matchId}/pause` */
export async function setPausedAction(matchId: string, paused: boolean) {
  await apiRequest(`/matches/${matchId}/pause`, { method: 'POST', body: { paused } });
}

/** `POST /matches/{matchId}/phases/{phaseId}/restart` */
export async function restartPhaseAction(matchId: string, phaseId: string) {
  await apiRequest(`/matches/${matchId}/phases/${phaseId}/restart`, { method: 'POST' });
}

/**
 * `POST /matches/{matchId}/finish` — devolve o pódio, e a tela o usa.
 *
 * A rota o devolve de propósito: quem clicou "Encerrar" é justamente quem vai
 * mostrá-lo. Descartar a resposta e esperar o `match.finished` deixaria o líder olhando
 * para o painel se o serviço de tempo real estivesse fora do ar.
 */
export async function finishMatchAction(matchId: string): Promise<PodiumEntry[]> {
  return apiRequest<PodiumEntry[]>(`/matches/${matchId}/finish`, { method: 'POST' });
}

/** `POST /matches/{matchId}/return-to-lobby` */
export async function returnToLobbyAction(matchId: string, roomCode?: string) {
  await apiRequest(`/matches/${matchId}/return-to-lobby`, { method: 'POST' });
  if (roomCode) {
    revalidateTag(`room:${roomCode}:participants`);
    revalidateTag(`room:${roomCode}`);
    revalidatePath(`/sala/${roomCode}/lobby`);
  }
}

/** `DELETE /matches/{matchId}/participants/{participantId}` */
export async function removePlayerFromMatchAction(matchId: string, participantId: string) {
  await apiRequest(`/matches/${matchId}/participants/${participantId}`, { method: 'DELETE' });
}
