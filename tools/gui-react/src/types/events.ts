export interface RuntimeEvent {
  ts: string;
  event: string;
  productId?: string;
  runId?: string;
  field?: string;
  url?: string;
  detail?: string;
  [key: string]: unknown;
}

export interface ProcessStatus {
  running: boolean;
  pid?: number;
  command?: string;
  startedAt?: string;
  endedAt?: string | null;
  exitCode?: number | null;
}
