import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export type ApiUser = {
  id: string;          // Firestore doc id
  displayName?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  // later: assignedProjects?: string[] or number[] depending on backend
};

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly baseUrl = 'https://localhost:7058'; // rm baseurl later

  constructor(private http: HttpClient) {}

  getUsers(): Observable<ApiUser[]> {
    return this.http.get<ApiUser[]>(`${this.baseUrl}/api/User`);
  }
}
