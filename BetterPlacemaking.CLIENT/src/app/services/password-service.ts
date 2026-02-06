import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

type ChangePasswordRequest = {
  currentPassword: string;
  newPassword: string;
};

@Injectable({ providedIn: 'root' })
export class PasswordService {
  // later you can move this to an environment file or proxy
  private readonly baseUrl = 'https://localhost:7058';

  constructor(private http: HttpClient) {}

  changeMyPassword(currentPassword: string, newPassword: string): Observable<void> {
    const body: ChangePasswordRequest = { currentPassword, newPassword };
    return this.http.post<void>(`${this.baseUrl}/api/Password/me/change`, body);
  }
}
