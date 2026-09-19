export enum SuggestionStatus {
  Pending = "pending",
  Accepted = "accepted",
  Rejected = "rejected",
  Superseded = "superseded",
}

export interface MatchSuggestionRecord {
  readonly id: string;
  readonly statementId: string;
  readonly lineId: string;
  readonly entryIds: readonly string[];
  readonly rank: number;
  readonly score: number;
  readonly amountScore: number;
  readonly dateScore: number;
  readonly referenceScore: number;
  readonly counterpartyScore: number;
  readonly dateDeltaDays: number;
  readonly status: SuggestionStatus;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly decidedBy: string | null;
}

export interface MatchSuggestionRepository {
  listByStatement(statementId: string): Promise<readonly MatchSuggestionRecord[]>;
  findById(id: string): Promise<MatchSuggestionRecord | null>;
  saveMany(records: readonly MatchSuggestionRecord[]): Promise<void>;
  update(record: MatchSuggestionRecord): Promise<void>;
  deletePending(statementId: string): Promise<void>;
}
