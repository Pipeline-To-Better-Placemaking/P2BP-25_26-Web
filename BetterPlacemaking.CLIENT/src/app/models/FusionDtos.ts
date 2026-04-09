export interface FusionRunDto {
  id: string;
  status: 'running' | 'success' | 'failed' | 'unknown';
  triggeredBy: 'manual' | 'scheduled' | 'unknown';
  fromDateUnix?: number;
  toDateUnix?: number;
  startedAtUnix?: number;
  completedAtUnix?: number;
  recordsFused?: number;
  errorMessage?: string;
  outputGcsPath?: string;
}

export interface FusionConfigDto {
  scheduledHourUtc: number;
  scheduledMinuteUtc: number;
  enabled: boolean;
}

export interface TriggerFusionDto {
  fromDateUnix: number;
  toDateUnix: number;
  projectId?: string;
}

export interface UpdateFusionConfigDto {
  scheduledHourUtc: number;
  scheduledMinuteUtc: number;
  enabled: boolean;
  projectId?: string;
}
