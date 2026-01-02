import { Injectable } from '@angular/core';
import { DeviceDto } from '../models/DeviceDto';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable, map } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class DeviceService {
  constructor(private readonly http: HttpClient) {}

  public getDevices(): Observable<DeviceDto[]> {
	return this.http.get<DeviceDto[]>(`${environment.apiBaseUrl}/api/device`);
  }

  public getDevice(id: string): Observable<DeviceDto> {
	return this.http.get<DeviceDto>(`${environment.apiBaseUrl}/api/device/${id}`);
  }

  public addDevice(device: DeviceDto): Observable<DeviceDto> {
	return this.http.post<DeviceDto>(`${environment.apiBaseUrl}/api/device`, device);
  }

  public updateDevice(id: string, device: DeviceDto): Observable<DeviceDto> {
	return this.http.put<DeviceDto>(`${environment.apiBaseUrl}/api/device/${id}`, device);
  }

  public deleteDevice(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/api/device/${id}`);
  }

  public getApiKey(id: string): Observable<string> {
    return this.http
      .post<{ apiKey?: string; ApiKey?: string }>(
        `${environment.apiBaseUrl}/api/device/${id}/apikey`,
        null,
      )
      .pipe(
        map((response) => response.apiKey ?? response.ApiKey ?? ''),
      );
  }
}
