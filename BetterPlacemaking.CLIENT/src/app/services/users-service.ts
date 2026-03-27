import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type ApiUser = {
  id?: string;
  Id?: string;         // Firestore doc id (PascalCase from API)
  FirstName?: string;
  LastName?: string;
  Email?: string;
};

export type ProjectRoleAssignmentDto = {
  ProjectId?: string;
  ProjectName?: string;
  Roles: string[];
};

export type UserProjectRoleAssignmentsDto = {
  UserId?: string;
  FirstName?: string;
  LastName?: string;
  Email?: string;
  Assignments: ProjectRoleAssignmentDto[];
};

export type UserProjectRoleAssignmentsUpdateDto = {
  UserId: string;
  Assignments: ProjectRoleAssignmentDto[];
};

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly baseUrl = environment.apiBaseUrl;

  constructor(private http: HttpClient) {}

  getUsers(): Observable<ApiUser[]> {
    return this.http.get<ApiUser[]>(`${this.baseUrl}/api/User`);
  }

  getProjectRoleOptions(): Observable<string[]> {
    return this.http.get<string[]>(`${this.baseUrl}/api/User/project-roles/options`);
  }

  getProjectRoleAssignments(): Observable<UserProjectRoleAssignmentsDto[]> {
    return this.http.get<UserProjectRoleAssignmentsDto[]>(`${this.baseUrl}/api/User/project-roles`);
  }

  setUserProjectRoleAssignments(payload: UserProjectRoleAssignmentsUpdateDto): Observable<void> {
    return this.http.put<void>(`${this.baseUrl}/api/User/project-roles`, payload);
  }
}
