'use server';

import {
  getMatchReportStatus,
  getMyIndividualReport,
  resolveRoomReport,
} from '@/lib/api/reports';
import type { IndividualReport, ReportStatusResponse, RoomReportResolution } from '@/lib/types';

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
