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
}

export interface FusionConfigDto {
  scheduledHourUtc: number;
  scheduledMinuteUtc: number;
  enabled: boolean;
}

export interface TriggerFusionDto {
  fromDateUnix: number;
  toDateUnix: number;
}

export interface UpdateFusionConfigDto {
  scheduledHourUtc: number;
  scheduledMinuteUtc: number;
  enabled: boolean;
}
