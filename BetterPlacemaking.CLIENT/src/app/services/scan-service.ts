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

@Injectable({ providedIn: 'root' })
export class ScanService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  // Immediate scan
  startScan(projectId: string, deviceId: string): Observable<{ Id: string; Status: string }> {
    return this.http.post<{ Id: string; Status: string }>(
      `${this.baseUrl}/api/scan/${projectId}/${deviceId}`, {}
    );
  }

  // Scan schedules
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
      `${this.baseUrl}/api/scan-schedule/${projectId}/${scheduleId}`, schedule
    );
  }

  loadLatestCompleteScanIntoVisualizer(projectId: string): Observable<LoadLatestScanVisualizerResponse> {
    return this.http.post<LoadLatestScanVisualizerResponse>(
      `${this.baseUrl}/api/scan/${encodeURIComponent(projectId)}/visualizer/latest`,
      {},
    );
  }
}
