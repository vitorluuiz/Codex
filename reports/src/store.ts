import { MongoClient, UUID, Binary, type Collection, type Db } from 'mongodb';

import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type {
  IndividualReportDto,
  LeaderReportHistoryItem,
  MatchReportDocument,
  ParticipantReportHistoryItem,
  RawMatchDocument,
  UserReportsHistoryDto,
} from './types.js';
import { toIndividualReport } from './builder.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Converte recursivamente valores BSON do driver .NET (UUID Binary subtype 4 e Decimal128)
 * para tipos primitivos JS (string, number, ISO string).
 */
export function normalizeBson<T>(value: unknown): T {
  if (value === null || value === undefined) return value as T;
  if (value instanceof Date) return value.toISOString() as T;

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const bsonType = obj._bsontype;

    if (bsonType === 'UUID' && typeof obj.toString === 'function') {
      return obj.toString() as T;
    }
    if (bsonType === 'Binary' || value instanceof Binary) {
      const bin = value as Binary;
      if (bin.sub_type === 4 && bin.buffer && bin.buffer.byteLength === 16) {
        return bytesToUuid(bin.buffer) as T;
      }
      if (typeof (bin as unknown as { toUUID?: () => UUID }).toUUID === 'function') {
        try {
          return (bin as unknown as { toUUID: () => UUID }).toUUID().toString() as T;
        } catch {
          /* ignora se nao for UUID */
        }
      }
    }
    if (bsonType === 'Decimal128' && typeof obj.toString === 'function') {
      return Number(obj.toString()) as T;
    }

    if (Array.isArray(value)) {
      return value.map((item) => normalizeBson(item)) as T;
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = normalizeBson(v);
    }
    return out as T;
  }

  return value as T;
}

export function normalizeRawMatch(doc: Record<string, unknown>): RawMatchDocument {
  const norm = normalizeBson<Record<string, unknown>>(doc);
  const id = String(norm._id ?? norm.id ?? '');
  return {
    id,
    schemaVersion: Number(norm.schemaVersion ?? 2),
    roomCode: String(norm.roomCode ?? ''),
    roomId: String(norm.roomId ?? ''),
    leaderUserId: String(norm.leaderUserId ?? ''),
    mode: norm.mode === 'self-paced' ? 'self-paced' : 'live',
    startedAt: String(norm.startedAt ?? new Date().toISOString()),
    finishedAt: String(norm.finishedAt ?? new Date().toISOString()),
    phaseSets: Array.isArray(norm.phaseSets) ? (norm.phaseSets as RawMatchDocument['phaseSets']) : [],
    phases: Array.isArray(norm.phases) ? (norm.phases as RawMatchDocument['phases']) : [],
    stats: (norm.stats as RawMatchDocument['stats']) ?? {
      participantCount: 0,
      avgScore: 0,
      maxScore: 0,
      accuracyRate: 0,
      phaseAccuracy: [],
      phaseAvgScore: [],
    },
    participants: Array.isArray(norm.participants)
      ? (norm.participants as RawMatchDocument['participants'])
      : [],
  };
}

export interface ReportStore {
  getRawMatch(matchId: string): Promise<RawMatchDocument | null>;
  saveRawMatchSnapshot(match: RawMatchDocument): Promise<void>;
  listUnprocessedMatchIds(limit: number): Promise<string[]>;
  listRawMatchesByUser(userId: string, limit: number): Promise<RawMatchDocument[]>;
  saveReport(report: MatchReportDocument): Promise<void>;
  getReportByMatchId(matchId: string): Promise<MatchReportDocument | null>;
  getReportByShareToken(shareToken: string): Promise<MatchReportDocument | null>;
  getIndividualByAccessToken(accessToken: string): Promise<IndividualReportDto | null>;
  getUserHistory(userId: string, limit?: number): Promise<UserReportsHistoryDto>;
  isMongoConnected(): boolean;
  close(): Promise<void>;
}

function toLeaderHistoryItem(r: MatchReportDocument): LeaderReportHistoryItem {
  return {
    matchId: r.matchId,
    shareToken: r.shareToken,
    roomCode: r.roomCode,
    title: r.title,
    mode: r.mode,
    finishedAt: r.finishedAt,
    generatedAt: r.generatedAt,
    durationSeconds: r.durationSeconds,
    participantCount: r.overview.participantCount,
    phaseCount: r.overview.phaseCount,
    avgScore: r.overview.avgScore,
    maxPossibleScore: r.overview.maxPossibleScore,
    accuracyRate: r.overview.accuracyRate,
  };
}

function toParticipantHistoryItem(
  r: MatchReportDocument,
  userId: string,
): ParticipantReportHistoryItem | null {
  const p = r.participants.find(
    (part) => part.userId && part.userId.toLowerCase() === userId.toLowerCase(),
  );
  if (!p) return null;
  return {
    matchId: r.matchId,
    accessToken: p.accessToken,
    roomCode: r.roomCode,
    title: r.title,
    mode: r.mode,
    finishedAt: r.finishedAt,
    displayName: p.displayName,
    avatarIndex: p.avatarIndex,
    rank: p.rank,
    participantCount: r.overview.participantCount,
    totalScore: p.totalScore,
    maxPossibleScore: p.maxPossibleScore,
    accuracyRate: p.accuracyRate,
    correctCount: p.correctCount,
    phaseCount: r.overview.phaseCount,
  };
}

export class HybridReportStore implements ReportStore {
  private client: MongoClient | null = null;
  private db: Db | null = null;
  private mongoAvailable = false;
  private connecting: Promise<Db | null> | null = null;

  private readonly memoryRawMatches = new Map<string, RawMatchDocument>();
  private readonly memoryReports = new Map<string, MatchReportDocument>();

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  isMongoConnected(): boolean {
    return this.mongoAvailable;
  }

  private async getDb(): Promise<Db | null> {
    if (!this.config.mongoUrl) return null;
    if (this.db) return this.db;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      try {
        const client = new MongoClient(this.config.mongoUrl!, {
          serverSelectionTimeoutMS: 3000,
          connectTimeoutMS: 3000,
        });
        await client.connect();
        const db = client.db(this.config.mongoDb);
        const reportsCol = db.collection('match_reports');

        await reportsCol.createIndexes([
          { key: { shareToken: 1 }, name: 'ix_shareToken', unique: true },
          { key: { 'participants.accessToken': 1 }, name: 'ix_participant_accessToken' },
          { key: { leaderUserId: 1, finishedAt: -1 }, name: 'ix_leader_finishedAt' },
          { key: { 'participants.userId': 1, finishedAt: -1 }, name: 'ix_participant_userId' },
        ]);

        this.client = client;
        this.db = db;
        this.mongoAvailable = true;
        this.logger.info('conectado ao MongoDB com indices de match_reports garantidos', {
          database: this.config.mongoDb,
        });
        return db;
      } catch (error) {
        this.mongoAvailable = false;
        this.logger.warn('MongoDB indisponivel — usando store em memoria como fallback', {
          error: (error as Error).message,
        });
        return null;
      } finally {
        this.connecting = null;
      }
    })();

    return this.connecting;
  }

  private matchesCol(db: Db): Collection<Record<string, unknown>> {
    return db.collection<Record<string, unknown>>('matches');
  }

  private reportsCol(db: Db): Collection<MatchReportDocument & { _id: string }> {
    return db.collection<MatchReportDocument & { _id: string }>('match_reports');
  }

  async saveRawMatchSnapshot(match: RawMatchDocument): Promise<void> {
    this.memoryRawMatches.set(match.id.toLowerCase(), match);
  }

  async getRawMatch(matchId: string): Promise<RawMatchDocument | null> {
    const cleanId = matchId.trim();
    const mem = this.memoryRawMatches.get(cleanId.toLowerCase());
    if (mem) return mem;

    const db = await this.getDb();
    if (!db) return null;

    try {
      const candidates: unknown[] = [cleanId, cleanId.toLowerCase()];
      if (UUID_REGEX.test(cleanId)) {
        candidates.push(new UUID(cleanId));
      }
      const doc = await this.matchesCol(db).findOne({ _id: { $in: candidates } } as Record<string, unknown>);
      if (!doc) return null;
      const raw = normalizeRawMatch(doc);
      this.memoryRawMatches.set(raw.id.toLowerCase(), raw);
      return raw;
    } catch (error) {
      this.logger.error('erro ao ler partida em matches', {
        matchId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async listUnprocessedMatchIds(limit: number): Promise<string[]> {
    const db = await this.getDb();
    if (!db) return [];

    try {
      const recentMatches = await this.matchesCol(db)
        .find({}, { projection: { _id: 1 } })
        .sort({ finishedAt: -1 })
        .limit(limit)
        .toArray();

      const ids = recentMatches
        .map((m) => String(normalizeBson(m._id) ?? ''))
        .filter((id) => id.length > 0);

      if (ids.length === 0) return [];

      const existing = await this.reportsCol(db)
        .find({ _id: { $in: ids } }, { projection: { _id: 1 } })
        .toArray();
      const existingSet = new Set(existing.map((e) => e._id.toLowerCase()));

      return ids.filter((id) => !existingSet.has(id.toLowerCase()));
    } catch (error) {
      this.logger.warn('falha ao listar partidas sem relatorio', {
        error: (error as Error).message,
      });
      return [];
    }
  }

  async listRawMatchesByUser(userId: string, limit: number): Promise<RawMatchDocument[]> {
    const cleanId = userId.trim();
    const db = await this.getDb();
    if (!db) {
      return [...this.memoryRawMatches.values()].filter(
        (m) =>
          m.leaderUserId.toLowerCase() === cleanId.toLowerCase() ||
          m.participants.some((p) => p.userId?.toLowerCase() === cleanId.toLowerCase()),
      );
    }

    try {
      const candidates: unknown[] = [cleanId, cleanId.toLowerCase()];
      if (UUID_REGEX.test(cleanId)) {
        candidates.push(new UUID(cleanId));
      }
      const docs = await this.matchesCol(db)
        .find({
          $or: [
            { leaderUserId: { $in: candidates } },
            { 'participants.userId': { $in: candidates } },
          ],
        } as Record<string, unknown>)
        .sort({ finishedAt: -1 })
        .limit(limit)
        .toArray();

      return docs.map((d) => normalizeRawMatch(d));
    } catch (error) {
      this.logger.warn('falha ao buscar partidas do usuario em matches', {
        userId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async saveReport(report: MatchReportDocument): Promise<void> {
    this.memoryReports.set(report.matchId.toLowerCase(), report);

    const db = await this.getDb();
    if (!db) return;

    try {
      const doc = { ...report, _id: report.matchId.toLowerCase() };
      await this.reportsCol(db).replaceOne({ _id: doc._id }, doc, { upsert: true });
    } catch (error) {
      this.logger.error('erro ao salvar match_report no MongoDB', {
        matchId: report.matchId,
        error: (error as Error).message,
      });
    }
  }

  async getReportByMatchId(matchId: string): Promise<MatchReportDocument | null> {
    const key = matchId.trim().toLowerCase();
    const mem = this.memoryReports.get(key);
    if (mem) return mem;

    const db = await this.getDb();
    if (!db) return null;

    try {
      const doc = await this.reportsCol(db).findOne({
        $or: [{ _id: key }, { matchId: matchId.trim() }, { matchId: key }],
      });
      if (!doc) return null;
      this.memoryReports.set(key, doc);
      return doc;
    } catch (error) {
      this.logger.error('erro ao buscar relatorio por matchId', {
        matchId,
        error: (error as Error).message,
      });
      return null;
    }
  }

  async getReportByShareToken(shareToken: string): Promise<MatchReportDocument | null> {
    const cleanToken = shareToken.trim();
    for (const report of this.memoryReports.values()) {
      if (report.shareToken === cleanToken) return report;
    }

    const db = await this.getDb();
    if (!db) return null;

    try {
      const doc = await this.reportsCol(db).findOne({ shareToken: cleanToken });
      if (!doc) return null;
      this.memoryReports.set(doc.matchId.toLowerCase(), doc);
      return doc;
    } catch (error) {
      this.logger.error('erro ao buscar relatorio por shareToken', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  async getIndividualByAccessToken(accessToken: string): Promise<IndividualReportDto | null> {
    const cleanToken = accessToken.trim();
    for (const report of this.memoryReports.values()) {
      const participant = report.participants.find((p) => p.accessToken === cleanToken);
      if (participant) return toIndividualReport(report, participant);
    }

    const db = await this.getDb();
    if (!db) return null;

    try {
      const doc = await this.reportsCol(db).findOne({ 'participants.accessToken': cleanToken });
      if (!doc) return null;
      this.memoryReports.set(doc.matchId.toLowerCase(), doc);
      const participant = doc.participants.find((p) => p.accessToken === cleanToken);
      if (!participant) return null;
      return toIndividualReport(doc, participant);
    } catch (error) {
      this.logger.error('erro ao buscar relatorio individual por accessToken', {
        error: (error as Error).message,
      });
      return null;
    }
  }

  async getUserHistory(userId: string, limit = 50): Promise<UserReportsHistoryDto> {
    const cleanUserId = userId.trim().toLowerCase();
    const byMatchId = new Map<string, MatchReportDocument>();

    for (const r of this.memoryReports.values()) {
      byMatchId.set(r.matchId.toLowerCase(), r);
    }

    const db = await this.getDb();
    if (db) {
      try {
        const docs = await this.reportsCol(db)
          .find({
            $or: [
              { leaderUserId: { $in: [userId.trim(), cleanUserId] } },
              { 'participants.userId': { $in: [userId.trim(), cleanUserId] } },
            ],
          })
          .sort({ finishedAt: -1 })
          .limit(limit)
          .toArray();

        for (const d of docs) {
          byMatchId.set(d.matchId.toLowerCase(), d);
        }
      } catch (error) {
        this.logger.warn('falha ao consultar historico de relatorios no Mongo', {
          error: (error as Error).message,
        });
      }
    }

    const allReports = [...byMatchId.values()].sort((a, b) =>
      b.finishedAt.localeCompare(a.finishedAt),
    );

    const leaderReports: LeaderReportHistoryItem[] = [];
    const participantReports: ParticipantReportHistoryItem[] = [];

    for (const r of allReports) {
      if (r.leaderUserId.toLowerCase() === cleanUserId) {
        leaderReports.push(toLeaderHistoryItem(r));
      }
      const pItem = toParticipantHistoryItem(r, cleanUserId);
      if (pItem) {
        participantReports.push(pItem);
      }
    }

    return {
      leaderReports: leaderReports.slice(0, limit),
      participantReports: participantReports.slice(0, limit),
    };
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => {});
      this.client = null;
      this.db = null;
      this.mongoAvailable = false;
    }
  }
}
