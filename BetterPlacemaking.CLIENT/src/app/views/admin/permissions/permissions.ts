import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { forkJoin } from 'rxjs';
import { MessageService } from 'primeng/api';

import {
  UsersService,
  ApiUser,
  UserProjectRoleAssignmentsDto,
} from '../../../services/users-service';
import { PermissionDirective } from '../../../directives/permission.directive';

interface UserRow {
  id: string;
  name: string;
  email: string;
  assignedCount: number;
}

@Component({
  selector: 'app-permissions',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableModule,
    ButtonModule,
    TagModule,
    ToastModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    PermissionDirective,
  ],
  templateUrl: './permissions.html',
  styleUrls: ['./permissions.scss'],
})
export class Permissions implements OnInit {
  users: UserRow[] = [];
  filteredUsers: UserRow[] = [];
  isLoading = false;

  searchText = '';
  sortField: 'name' | 'assignedCount' = 'name';
  sortAsc = true;

  private assignedCountByUserId = new Map<string, number>();

  constructor(
    private readonly usersService: UsersService,
    private readonly messageService: MessageService,
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  private loadData(): void {
    this.isLoading = true;

    forkJoin({
      users: this.usersService.getUsers(),
      assignments: this.usersService.getProjectRoleAssignments(),
    }).subscribe({
      next: ({ users, assignments }) => {
        this.assignedCountByUserId = this.buildAssignedCountMap(assignments);
        this.users = users
          .map((u: ApiUser) => {
            const userId = this.pickUserId(u);
            if (!userId)
              return null;

            return {
              id: userId,
              name: this.pickName(u),
              email: u.Email ?? '',
              assignedCount: this.assignedCountByUserId.get(userId) ?? 0,
            };
          })
          .filter((user): user is UserRow => user !== null);

        this.applyFilters();
      },
      error: () => {
        this.messageService.add({
          key: 'permissions',
          severity: 'error',
          summary: 'Load Failed',
          detail: 'Failed to load users.',
        });
      },
      complete: () => {
        this.isLoading = false;
      },
    });
  }

  private pickUserId(u: ApiUser): string | null {
    const id = (u.Id ?? u.id ?? '').trim();
    return id.length > 0 ? id : null;
  }

  private pickName(u: ApiUser): string {
    const full = `${u.FirstName ?? ''} ${u.LastName ?? ''}`.trim();
    if (full)
      return full;

    return u.Email ?? '(unknown user)';
  }

  private buildAssignedCountMap(assignments: UserProjectRoleAssignmentsDto[]): Map<string, number> {
    const countMap = new Map<string, number>();
    for (const assignment of assignments) {
      const userId = (assignment.UserId ?? '').trim();
      if (!userId)
        continue;

      countMap.set(userId, assignment.Assignments?.length ?? 0);
    }

    return countMap;
  }

  applyFilters(): void {
    const search = this.searchText.toLowerCase().trim();

    const result = this.users.filter((user) => {
      if (!search)
        return true;

      return user.name.toLowerCase().includes(search)
        || user.email.toLowerCase().includes(search);
    });

    result.sort((a, b) => {
      let cmp = 0;
      if (this.sortField === 'name')
        cmp = a.name.localeCompare(b.name);
      else
        cmp = a.assignedCount - b.assignedCount;

      return this.sortAsc ? cmp : -cmp;
    });

    this.filteredUsers = result;
  }

  onSearchChange(): void {
    this.applyFilters();
  }

  toggleSort(field: 'name' | 'assignedCount'): void {
    if (this.sortField === field)
      this.sortAsc = !this.sortAsc;
    else {
      this.sortField = field;
      this.sortAsc = true;
    }

    this.applyFilters();
  }

  clearFilters(): void {
    this.searchText = '';
    this.sortField = 'name';
    this.sortAsc = true;
    this.applyFilters();
  }

  get hasActiveFilters(): boolean {
    return this.searchText.trim().length > 0;
  }
}
