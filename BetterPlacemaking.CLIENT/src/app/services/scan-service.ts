import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface ScanScheduleDto {
  Id?: string;
  StartDate: string;
  StartTime: string;
  Frequency: string;
  EndDate?: string;
  EndTime?: string;
}

export interface LoadLatestScanVisualizerResponse {
  success: boolean;
  reason?: string;
  message?: string;
  deviceId?: string;
  scanId?: string;
}

export interface ScanRecordDto {
  Id?: string;
  Status?: string;
  CreatedAt?: any;
  StartedAt?: any;
  FinishedAt?: any;
  ObjUrl?: string | null;
  Error?: string | null;
}

export type ScanResolution = 1 | 8 | 16 | 32 | 64;
export type ProtocolMode = 'legacy' | 'express' | 'dense' | 'ultra';
export type OrientationMode = 'table' | 'ceiling' | 'wall' | 'custom';
export type OutputMode = 'filtered_only' | 'raw_only' | 'raw_and_filtered';
export type SplitMode = 'none' | 'front_back_180';
export type CaptureStrategy = 'fixed_time' | 'min_revolutions' | 'hybrid';
export type ScanPreset = 'base' | 'medium' | 'high';

export interface ScanSettingsPayload {
  scan_resolution: ScanResolution;
  protocol_mode: ProtocolMode;
  orientation_mode: OrientationMode;
  output_mode: OutputMode;
  split_mode: SplitMode;
  filter_enabled: boolean;
  capture_strategy: CaptureStrategy;
  min_revolutions_per_slice: 1 | 2 | 3;
  force_recalibration: boolean;
}

export const BASE_SCAN_SETTINGS: ScanSettingsPayload = {
  scan_resolution: 8,
  protocol_mode: 'legacy',
  orientation_mode: 'table',
  output_mode: 'filtered_only',
  split_mode: 'none',
  filter_enabled: false,
  capture_strategy: 'hybrid',
  min_revolutions_per_slice: 1,
  force_recalibration: false
};

export const SCAN_PRESETS: Record<ScanPreset, ScanSettingsPayload> = {
  base: {
    scan_resolution: 8,
    protocol_mode: 'legacy',
    orientation_mode: 'table',
    output_mode: 'filtered_only',
    split_mode: 'none',
    filter_enabled: false,
    capture_strategy: 'hybrid',
    min_revolutions_per_slice: 1,
    force_recalibration: false
  },
  medium: {
    scan_resolution: 16,
    protocol_mode: 'express',
    orientation_mode: 'table',
    output_mode: 'filtered_only',
    split_mode: 'none',
    filter_enabled: true,
    capture_strategy: 'hybrid',
    min_revolutions_per_slice: 2,
    force_recalibration: false
  },
  high: {
    scan_resolution: 32,
    protocol_mode: 'dense',
    orientation_mode: 'table',
    output_mode: 'raw_and_filtered',
    split_mode: 'none',
    filter_enabled: true,
    capture_strategy: 'min_revolutions',
    min_revolutions_per_slice: 3,
    force_recalibration: false
  }
};

@Injectable({ providedIn: 'root' })
export class ScanService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  startScan(
    projectId: string,
    deviceId: string,
    settings: ScanSettingsPayload
  ): Observable<{ Id: string; Status: string }> {
    return this.http.post<{ Id: string; Status: string }>(
      `${this.baseUrl}/api/scan/${projectId}/${deviceId}`,
      settings
    );
  }

  createSchedule(projectId: string, schedule: ScanScheduleDto): Observable<{ Id: string }> {
    return this.http.post<{ Id: string }>(
      `${this.baseUrl}/api/scan-schedule/${projectId}`, schedule
    );
  }

  getSchedules(projectId: string): Observable<ScanScheduleDto[]> {
    return this.http.get<ScanScheduleDto[]>(
      `${this.baseUrl}/api/scan-schedule/${projectId}`
    );
  }

  deleteSchedule(projectId: string, scheduleId: string): Observable<void> {
    return this.http.delete<void>(
      `${this.baseUrl}/api/scan-schedule/${projectId}/${scheduleId}`
    );
  }

  updateSchedule(projectId: string, scheduleId: string, schedule: ScanScheduleDto): Observable<void> {
    return this.http.put<void>(
      `${this.baseUrl}/api/scan-schedule/${projectId}/${scheduleId}`,
      schedule
    );
  }

  loadLatestCompleteScanIntoVisualizer(projectId: string): Observable<LoadLatestScanVisualizerResponse> {
    return this.http.post<LoadLatestScanVisualizerResponse>(
      `${this.baseUrl}/api/scan/${encodeURIComponent(projectId)}/visualizer/latest`,
      {},
    );
  }

  getScans(projectId: string, deviceId: string): Observable<ScanRecordDto[]> {
  return this.http.get<ScanRecordDto[]>(
    `${this.baseUrl}/api/scan/${projectId}/${deviceId}`
  );
}
}
