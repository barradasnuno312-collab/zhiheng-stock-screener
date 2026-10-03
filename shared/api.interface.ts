/** Versioned public contract. Financial values never use 0 to represent missing data. */
export const METRIC_IDS = [
  'revenue_yoy_pct', 'revenue_yoy_delta_pp', 'parent_profit_yoy_pct',
  'pe_ttm', 'pb_mrq', 'volatility_60d_pct', 'max_drawdown_60d_pct',
  'avg_turnover_20d_cny', 'return_20d_pct', 'price_vs_ma20_pct',
] as const;
export type MetricId = typeof METRIC_IDS[number];
export type Operator = 'gt' | 'gte' | 'lt' | 'lte' | 'between';
export type Verdict = 'pass' | 'fail' | 'unknown';
export type Unit = '%' | '百分点' | '倍' | '元';

export interface MetricDefinition {
  id: MetricId;
  name: string;
  unit: Unit;
  basis: string;
  summary: string;
  description: string;
  min: number;
  max: number;
}
export interface Condition {
  id: string;
  metricId: MetricId;
  operator: Operator;
  value: number;
  upperValue?: number;
  enabled: boolean;
  originalPhrase: string;
  assumptionReason: string;
  unit: Unit;
  basis: string;
}
export interface IntentDraft {
  intentSummary: string;
  conditions: Condition[];
  clarifications: string[];
  unsupportedRequests: string[];
  warnings: string[];
}
export interface SourceInput {
  rawField: string;
  rawValue: string | number | null;
  reportPeriod: string | null;
  disclosureDate: string | null;
  quoteDate: string | null;
}
export interface MetricEvidence {
  metricId: MetricId;
  value: number | null;
  unit: Unit;
  status: 'available' | 'missing' | 'not_applicable' | 'error';
  reason: string;
  inputs: SourceInput[];
  reportPeriod: string | null;
  disclosureDate: string | null;
  quoteDate: string | null;
  fetchedAt: string;
  timestampScope: 'per_report' | 'per_bar' | 'response_max_only' | 'unknown';
  sourceEndpoint: string;
  requestId: string | null;
  sourceTimestamp: string | null;
  formulaVersion: string;
}
export interface PricePoint {
  date: string;
  close: number | null;
  volume: number | null;
  turnover: number | null;
}
export interface StockFacts {
  code: string;
  name: string;
  metrics: Record<MetricId, MetricEvidence>;
  prices: PricePoint[];
  errors: string[];
}
export interface SnapshotSummary {
  id: string;
  universeVersion: string;
  universeName: '沪深300';
  memberCount: number;
  quoteDate: string;
  fetchedAt: string;
  status: 'loading' | 'ready' | 'partial' | 'failed';
  completedCount: number;
  errorCount: number;
  marketClosed: boolean;
  warnings: string[];
}
export interface DatasetSnapshot extends SnapshotSummary {
  stocks: StockFacts[];
}
export interface ConditionResult {
  conditionId: string;
  verdict: Verdict;
  explanation: string;
  evidence: MetricEvidence;
}
export interface StockResult {
  code: string;
  name: string;
  verdict: Verdict;
  conditions: ConditionResult[];
  onlyOneFailure: boolean;
}
export interface ScreenRun {
  id: string;
  snapshot: SnapshotSummary;
  rulesVersion: string;
  conditions: Condition[];
  createdAt: string;
  intent: string;
  results: StockResult[];
  coverage: { total: number; pass: number; fail: number; unknown: number; complete: number };
}
export interface ConditionConflict {
  metricId: MetricId;
  conditionIds: string[];
  message: string;
}
export interface ResultChange {
  code: string;
  name: string;
  before: Verdict | 'outside';
  after: Verdict | 'outside';
  reasons: string[];
}
export interface RunComparison {
  snapshotId: string;
  beforeRunId: string;
  afterRunId: string;
  entered: string[];
  exited: string[];
  retained: string[];
  becameUnknown: string[];
  changes: ResultChange[];
  independentEffects: { conditionId: string; entered: number; exited: number }[];
}
export interface SavedVersion {
  id: string;
  strategyId: string;
  version: number;
  name: string;
  intent: string;
  runId: string;
  createdAt: string;
  conditions: Condition[];
  snapshot: SnapshotSummary;
}
export interface MonitorEvent {
  id: string;
  monitorId: string;
  source: 'manual' | 'schedule';
  checkedAt: string;
  status: 'changed' | 'unchanged' | 'closed' | 'pending' | 'failed';
  message: string;
  changes: ResultChange[];
  runId: string | null;
}
export interface Monitor {
  id: string;
  versionId: string;
  name: string;
  enabled: boolean;
  schedule: string;
  lastCheckedAt: string | null;
  events: MonitorEvent[];
}
export interface JobStatus {
  id: string;
  kind: 'intent' | 'refresh';
  status: 'pending' | 'running' | 'succeeded' | 'failed';
  progress: number;
  message: string;
  createdAt: string;
  result?: IntentDraft | SnapshotSummary;
}
export interface CatalogResponse {
  metrics: MetricDefinition[];
  rulesVersion: string;
  snapshot: SnapshotSummary | null;
  dataConfigured: boolean;
  aiConfigured: boolean;
  scheduleEnabled: boolean;
}
export interface ScreenRequest {
  conditions: Condition[];
  snapshotId: string;
  universeVersion: string;
  intent: string;
  confirmed: boolean;
}
export interface ParseRequest {
  text: string;
  previousConditions: Condition[];
}
export interface SaveStrategyRequest {
  name: string;
  runId: string;
  strategyId?: string;
}
export interface AccessSession {
  authorized: boolean;
  expiresAt: string | null;
}
export interface AccountCredentials {
  username: string;
  password: string;
}
export interface AccountStatus {
  registered: boolean;
  username: string | null;
}
export interface CompareRequest {
  beforeRunId: string;
  afterRunId: string;
}
export interface StockCompareResponse {
  snapshot: SnapshotSummary;
  stocks: StockFacts[];
  results: StockResult[];
}
export interface LoadVersionResponse {
  version: SavedVersion;
  run: ScreenRun;
}
export interface SnapshotReplayEntry {
  snapshot: SnapshotSummary;
  coverage: ScreenRun['coverage'];
  changedCount: number;
  entered: number;
  exited: number;
  becameUnknown: number;
  examples: ResultChange[];
}
export interface SnapshotReplay {
  versionId: string;
  strategyName: string;
  entries: SnapshotReplayEntry[];
  note: string;
}
export interface CreateMonitorRequest {
  versionId: string;
}
export interface ToggleMonitorRequest {
  enabled: boolean;
}
export interface RecoveryResponse {
  processed: number;
}
