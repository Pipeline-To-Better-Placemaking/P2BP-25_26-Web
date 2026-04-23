export interface FusionRunDto {
  Id: string;
  Status: 'running' | 'cancelling' | 'cancelled' | 'success' | 'failed' | 'unknown';
  TriggeredBy: 'manual' | 'scheduled' | 'unknown';
  FromDateUnix?: number;
  ToDateUnix?: number;
  StartedAtUnix?: number;
  CompletedAtUnix?: number;
  RecordsFused?: number;
  ErrorMessage?: string;
  OutputGcsPath?: string;
  ProjectId?: string;
}

export interface FusionConfigDto {
  ScheduledHourUtc: number;
  ScheduledMinuteUtc: number;
  Enabled: boolean;
  ProjectId?: string;
}

export interface TriggerFusionDto {
  FromDateUnix: number;
  ToDateUnix: number;
  ProjectId?: string;
}

export interface UpdateFusionConfigDto {
  ScheduledHourUtc: number;
  ScheduledMinuteUtc: number;
  Enabled: boolean;
  ProjectId?: string;
}
