import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

type UserSettingsDto = {
  FirstName?: string;
  LastName?: string;
  EmailAlerts?: boolean;
  ScanCompletionAlerts?: boolean;
  ChangeDetectionAlerts?: boolean;
};

@Injectable({ providedIn: 'root' })
export class UserSettingsService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  getMySettings(): Observable<UserSettingsDto> {
    return this.http.get<UserSettingsDto>(`${this.baseUrl}/api/User/me/settings`);
  }

  updateMySettings(dto: UserSettingsDto): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/api/User/me/settings`, dto);
  }
}
