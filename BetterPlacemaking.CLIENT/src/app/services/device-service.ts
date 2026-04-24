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

  public getDevicesByProject(projectId: string): Observable<DeviceDto[]> {
    return this.http
      .get<DeviceDto[]>(`${environment.apiBaseUrl}/api/device/project/${projectId}`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load project devices')));
  }

  public getDevice(projectId: string | null | undefined, id: string): Observable<DeviceDto> {
    return this.http
      .get<DeviceDto>(`${environment.apiBaseUrl}/api/device/project/${projectId}/${id}`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load device')));
  }

  public addDevice(device: DeviceDto): Observable<DeviceDto> {
    if (!device?.ProjectId)
      throw new Error('ProjectId is required to add a device');

    return this.http
      .post<DeviceDto>(`${environment.apiBaseUrl}/api/device/project/${device.ProjectId}`, device)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to add device')));
  }

  public updateDevice(id: string, device: DeviceDto): Observable<DeviceDto> {
    if (!device?.ProjectId)
      throw new Error('ProjectId is required to update a device');

    return this.http
      .put<DeviceDto>(`${environment.apiBaseUrl}/api/device/project/${device.ProjectId}/${id}`, device)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to update device')));
  }

  public deleteDevice(projectId: string, id: string): Observable<void> {
    return this.http
		.delete<void>(`${environment.apiBaseUrl}/api/device/project/${projectId}/${id}`)
		.pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to delete device')));
  }

  public getApiKey(projectId: string, id: string): Observable<string> {
    return this.http
      .post<{ apiKey?: string; ApiKey?: string }>(
        `${environment.apiBaseUrl}/api/device/project/${projectId}/${id}/apikey`,
        null,
      )
      .pipe(
        map((response) => response.apiKey ?? response.ApiKey ?? ''),
        catchError((err) => this.errorHandler.handleError(err, 'Failed to generate API key')),
      );
  }
}
