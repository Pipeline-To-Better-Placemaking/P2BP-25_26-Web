import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

type UpdateUserSettingsDto = {
  displayName?: string;
  emailAlerts?: boolean;
  scanCompletionAlerts?: boolean;
  changeDetectionAlerts?: boolean;
};

@Injectable({ providedIn: 'root' })
export class UserSettingsService {
  // Use your backend base URL (or proxy later)
  private readonly baseUrl = 'https://localhost:7058';

  constructor(private http: HttpClient) {}

  updateMySettings(dto: UpdateUserSettingsDto): Observable<void> {
    return this.http.patch<void>(`${this.baseUrl}/api/User/me/settings`, dto);
  }
}
