import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
};

type PasswordResetRequest = {
  email: string;
};

@Injectable({ providedIn: 'root' })
export class PasswordService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  changeMyPassword(currentPassword: string, newPassword: string): Observable<void> {
    const body: ChangePasswordRequest = { currentPassword, newPassword };
    return this.http.post<void>(`${this.baseUrl}/api/Password/me/change`, body);
  }

  requestPasswordReset(email: string): Observable<unknown> {
    const body: PasswordResetRequest = { email };
    return this.http.post(`${this.baseUrl}/api/Password/request-reset`, body);
  }
}
