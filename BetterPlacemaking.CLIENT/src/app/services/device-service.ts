import { Injectable } from '@angular/core';
import { DeviceDto } from '../models/DeviceDto';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable, catchError, map } from 'rxjs';
import { ErrorHandlerService } from './error-handler-service';

@Injectable({
  providedIn: 'root',
})
export class DeviceService {
  constructor(
	private readonly http: HttpClient,
	private readonly errorHandler: ErrorHandlerService,
  ) {}

  public getDevices(): Observable<DeviceDto[]> {
  return this.http
    .get<DeviceDto[]>(`${environment.apiBaseUrl}/api/device`)
    .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load devices')));
  }

  public getDevice(id: string): Observable<DeviceDto> {
  return this.http
    .get<DeviceDto>(`${environment.apiBaseUrl}/api/device/${id}`)
    .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load device')));
  }

  public addDevice(device: DeviceDto): Observable<DeviceDto> {
  return this.http
    .post<DeviceDto>(`${environment.apiBaseUrl}/api/device`, device)
    .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to add device')));
  }

  public updateDevice(id: string, device: DeviceDto): Observable<DeviceDto> {
  return this.http
    .put<DeviceDto>(`${environment.apiBaseUrl}/api/device/${id}`, device)
    .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to update device')));
  }

  public deleteDevice(id: string): Observable<void> {
    return this.http
		.delete<void>(`${environment.apiBaseUrl}/api/device/${id}`)
		.pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to delete device')));
  }

  public getApiKey(id: string): Observable<string> {
    return this.http
      .post<{ apiKey?: string; ApiKey?: string }>(
        `${environment.apiBaseUrl}/api/device/${id}/apikey`,
        null,
      )
      .pipe(
        map((response) => response.apiKey ?? response.ApiKey ?? ''),
        catchError((err) => this.errorHandler.handleError(err, 'Failed to generate API key')),
      );
  }
}
