import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface CombineScanItemRequest {
  scanId: string;
  x_translation: number;
  y_translation: number;
  Theta: number;
}

export interface CombineScansRequest {
  output_name: string;
  scalar_mm_per_pixel?: number | null;
  items: CombineScanItemRequest[];
}

@Injectable({ providedIn: 'root' })
export class ScanCalibrationService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  public getPreview(projectId: string, deviceId: string, scanId: string): string {
    return `${this.baseUrl}/api/ScanCalibration/${projectId}/${deviceId}/${scanId}/preview`;
  }

  public uploadXyz(projectId: string, deviceId: string, file: File): Observable<any> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<any>(
      `${this.baseUrl}/api/ScanCalibration/${projectId}/${deviceId}/upload-xyz`,
      formData
    );
  }

  public combine(projectId: string, deviceId: string, payload: CombineScansRequest): Observable<any> {
    return this.http.post<any>(
      `${this.baseUrl}/api/ScanCalibration/${projectId}/${deviceId}/combine`,
      payload
    );
  }
}
