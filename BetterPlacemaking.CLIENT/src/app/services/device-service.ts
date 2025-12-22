import { Injectable } from '@angular/core';
import { Device } from '../models/Device';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class DeviceService {
  constructor(private http: HttpClient) {}

  public getDevices(): Observable<Device[]> {
    return this.http.get<Device[]>(`${environment.apiBaseUrl}/api/device`);
  }

  public getDevice(id: string): Observable<Device> {
    return this.http.get<Device>(`${environment.apiBaseUrl}/api/device/${id}`);
  }

  public addDevice(device: Device): Observable<Device> {
    return this.http.post<Device>(`${environment.apiBaseUrl}/api/device`, device);
  }

  public updateDevice(id: string, device: Device): Observable<Device> {
    return this.http.put<Device>(`${environment.apiBaseUrl}/api/device/${id}`, device);
  }

  public deleteDevice(id: string): Observable<void> {
    return this.http.delete<void>(`${environment.apiBaseUrl}/api/device/${id}`);
  }
}
