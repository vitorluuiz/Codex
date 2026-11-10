'use server';

import { ApiError, ApiNotConfiguredError, apiRequest } from '@/lib/api/client';
import {
  getMatchReportStatus,
  getMyIndividualReport,
  resolveRoomReport,
} from '@/lib/api/reports';
import type {
  AiReportReviewResponse,
  IndividualReport,
  ReportStatusResponse,
  RoomReportResolution,
} from '@/lib/types';
import type { AiActionResult } from './ai';

export async function getMatchReportStatusAction(
  matchId: string,
): Promise<ReportStatusResponse | null> {
  return getMatchReportStatus(matchId);
}

export async function getMyIndividualReportAction(
  matchId: string,
): Promise<IndividualReport | null> {
  return getMyIndividualReport(matchId);
}

export async function resolveRoomReportAction(
  roomCode: string,
): Promise<RoomReportResolution | null> {
  return resolveRoomReport(roomCode);
}

export async function runReportAiReviewAction(
  matchId: string,
): Promise<AiActionResult<AiReportReviewResponse>> {
  try {
    const data = await apiRequest<AiReportReviewResponse>(
      `/matches/${encodeURIComponent(matchId)}/report/ai-review`,
      { method: 'POST' },
    );
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        ok: false,
        code: error.code ?? 'AI_PROVIDER_UNAVAILABLE',
        message: error.message,
        usage: error.usage,
      };
    }
    if (error instanceof ApiNotConfiguredError) {
      return {
        ok: false,
        code: 'AI_NOT_CONFIGURED',
        message: 'A revisão por IA não está configurada neste ambiente.',
      };
    }
    return {
      ok: false,
      code: 'AI_PROVIDER_UNAVAILABLE',
      message: 'Não foi possível executar a revisão por IA. Tente novamente.',
    };
  }
}
