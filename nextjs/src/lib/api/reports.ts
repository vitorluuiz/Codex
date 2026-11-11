import 'server-only';

import { apiRequestOrNull } from './client';
import type {
  IndividualReport,
  MatchReport,
  ReportStatusResponse,
  RoomReportResolution,
  UserReportsHistory,
} from '@/lib/types';

export async function getMatchReportStatus(matchId: string): Promise<ReportStatusResponse | null> {
  return apiRequestOrNull<ReportStatusResponse>(
    `/matches/${encodeURIComponent(matchId)}/report/status`,
  );
}

export async function getMatchReportById(matchId: string): Promise<MatchReport | null> {
  return apiRequestOrNull<MatchReport>(`/matches/${encodeURIComponent(matchId)}/report`);
}

export async function getMyIndividualReport(matchId: string): Promise<IndividualReport | null> {
  return apiRequestOrNull<IndividualReport>(`/matches/${encodeURIComponent(matchId)}/report/me`);
}

export async function resolveRoomReport(roomCode: string): Promise<RoomReportResolution | null> {
  return apiRequestOrNull<RoomReportResolution>(
    `/rooms/${encodeURIComponent(roomCode)}/report/resolve`,
  );
}

export async function getReportByShareToken(shareToken: string): Promise<MatchReport | null> {
  return apiRequestOrNull<MatchReport>(`/reports/share/${encodeURIComponent(shareToken)}`, {
    withSession: false,
  });
}

export async function getIndividualReportByToken(
  accessToken: string,
): Promise<IndividualReport | null> {
  return apiRequestOrNull<IndividualReport>(
    `/reports/individual/${encodeURIComponent(accessToken)}`,
    { withSession: false },
  );
}

export async function getUserReportsHistory(userId: string): Promise<UserReportsHistory | null> {
  return apiRequestOrNull<UserReportsHistory>(`/users/${encodeURIComponent(userId)}/reports`);
}
