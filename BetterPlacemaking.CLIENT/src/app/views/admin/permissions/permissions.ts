import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { forkJoin } from 'rxjs';
import { MessageService } from 'primeng/api';

import { ProjectService } from '../../../services/project-service';
import { ProjectDto } from '../../../models/ProjectDto';
import {
  UsersService,
  ApiUser,
  UserProjectRoleAssignmentsDto,
  ProjectRoleAssignmentDto,
} from '../../../services/users-service';

interface UserRow {
  id: string;
  firstName: string;
  name: string;
  email: string;
  assignedCount: number;
}

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-permissions',
  standalone: true,
  imports: [
    CommonModule,
    TableModule,
    DialogModule,
    SelectModule,
    FormsModule,
    ButtonModule,
    TagModule,
    ToastModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    ToggleButtonModule,
  ],
  templateUrl: './permissions.html',
  styleUrls: ['./permissions.scss'],
})
export class Permissions implements OnInit {
  users: UserRow[] = [];
  filteredUsers: UserRow[] = [];
  projects: ProjectDto[] = [];
  roleOptions: SelectOption[] = [];
  roleOptionsWithNone: SelectOption[] = [];
  selectedUser: UserRow | null = null;
  isDialogVisible = false;
  isLoading = false;
  isSaving = false;

  searchText = '';
  filterProject: string | null = null;
  filterRole: string | null = null;
  showUnassignedOnly = false;
  sortField: 'name' | 'assignedCount' = 'name';
  sortAsc = true;

  projectFilterOptions: SelectOption[] = [];
  roleFilterOptions: SelectOption[] = [];

  private assignmentByUser = new Map<string, Map<string, string>>();
  draftProjectRoles: Record<string, string | null> = {};

  constructor(
    private usersService: UsersService,
    private projectService: ProjectService,
    private messageService: MessageService,
  ) {}

  ngOnInit(): void {
    this.loadData();
  }

  private pickName(u: ApiUser): string {
    const full = `${u.FirstName ?? ''} ${u.LastName ?? ''}`.trim();
    if (full)
      return full;

    return u.Email ?? '(unknown user)';
  }

  private pickUserId(u: ApiUser): string | null {
    const id = (u.Id ?? u.id ?? '').trim();
    return id.length > 0 ? id : null;
  }

  private loadData(): void {
    this.isLoading = true;

    forkJoin({
      users: this.usersService.getUsers(),
      projects: this.projectService.getProjects(),
      assignments: this.usersService.getProjectRoleAssignments(),
      roles: this.usersService.getProjectRoleOptions(),
    }).subscribe({
      next: ({ users, projects, assignments, roles }) => {
        this.projects = projects;
        this.assignmentByUser = this.buildAssignmentMap(assignments);
        this.users = users
          .map((u: ApiUser) => {
            const userId = this.pickUserId(u);
            if (!userId)
              return null;

            return {
              id: userId,
              firstName: (u.FirstName ?? '').trim(),
              name: this.pickName(u),
              email: u.Email ?? '',
              assignedCount: this.countAssignedProjects(userId),
            };
          })
          .filter((user): user is UserRow => user !== null);

        this.roleOptions = roles.map((role) => ({ label: role, value: role }));
        this.roleOptionsWithNone = [
          { label: 'No Access', value: '' },
          ...this.roleOptions,
        ];
        this.roleFilterOptions = [...this.roleOptions];
        this.projectFilterOptions = projects
          .filter((p) => !!p.Id)
          .map((p) => ({ label: p.Title || p.Id, value: p.Id }));

        this.applyFilters();
      },
      error: () => {
        this.messageService.add({
          key: 'permissions',
          severity: 'error',
          summary: 'Load Failed',
          detail: 'Failed to load permissions data.',
        });
      },
      complete: () => {
        this.isLoading = false;
      },
    });
  }

  private buildAssignmentMap(assignments: UserProjectRoleAssignmentsDto[]): Map<string, Map<string, string>> {
    const result = new Map<string, Map<string, string>>();

    for (const userAssignment of assignments) {
      if (!userAssignment.UserId)
        continue;

      const projectMap = new Map<string, string>();
      for (const assignment of userAssignment.Assignments ?? []) {
        const projectId = assignment.ProjectId?.trim();
        if (!projectId)
          continue;

        const primaryRole = this.pickPrimaryRole(assignment);
        if (!primaryRole)
          continue;

        projectMap.set(projectId, primaryRole);
      }

      result.set(userAssignment.UserId, projectMap);
    }

    return result;
  }

  private pickPrimaryRole(assignment: ProjectRoleAssignmentDto): string | null {
    const role = assignment.Roles?.find((candidate) => !!candidate?.trim());
    return role?.trim() || null;
  }

  private countAssignedProjects(userId: string): number {
    return this.assignmentByUser.get(userId)?.size ?? 0;
  }

  getUserProjectSummary(userId: string): string {
    const projectRoles = this.assignmentByUser.get(userId);
    if (!projectRoles || projectRoles.size === 0)
      return 'No project access';

    const names: string[] = [];
    for (const project of this.projects) {
      const projectId = project.Id?.trim();
      if (!projectId)
        continue;

      if (projectRoles.has(projectId))
        names.push(project.Title || projectId);

      if (names.length === 2)
        break;
    }

    if (projectRoles.size > names.length)
      names.push(`+${projectRoles.size - names.length} more`);

    return names.join(', ');
  }

  applyFilters(): void {
    const search = this.searchText.toLowerCase().trim();

    let result = this.users.filter((user) => {
      // Text search: name, email, or project titles
      if (search) {
        const nameMatch = user.name.toLowerCase().includes(search);
        const emailMatch = user.email.toLowerCase().includes(search);
        const projectRoles = this.assignmentByUser.get(user.id);
        let projectMatch = false;
        if (projectRoles) {
          for (const project of this.projects) {
            const pid = project.Id?.trim();
            if (pid && projectRoles.has(pid)) {
              const title = (project.Title || '').toLowerCase();
              if (title.includes(search)) {
                projectMatch = true;
                break;
              }
            }
          }
        }
        if (!nameMatch && !emailMatch && !projectMatch) return false;
      }

      // Filter by project + role (combined when both active)
      const projectRoles = this.assignmentByUser.get(user.id);
      if (this.filterProject && this.filterRole) {
        const roleOnProject = projectRoles?.get(this.filterProject);
        if (roleOnProject !== this.filterRole) return false;
      } else if (this.filterProject) {
        if (!projectRoles?.has(this.filterProject)) return false;
      } else if (this.filterRole) {
        if (!projectRoles) return false;
        let hasRole = false;
        for (const role of projectRoles.values()) {
          if (role === this.filterRole) { hasRole = true; break; }
        }
        if (!hasRole) return false;
      }

      // Unassigned only
      if (this.showUnassignedOnly && user.assignedCount > 0) return false;

      return true;
    });

    // Sort
    result.sort((a, b) => {
      let cmp: number;
      if (this.sortField === 'name') {
        cmp = a.firstName.localeCompare(b.firstName);
      } else {
        cmp = a.assignedCount - b.assignedCount;
      }
      return this.sortAsc ? cmp : -cmp;
    });

    this.filteredUsers = result;
  }

  onSearchChange(): void {
    this.applyFilters();
  }

  onFilterChange(): void {
    this.applyFilters();
  }

  toggleSort(field: 'name' | 'assignedCount'): void {
    if (this.sortField === field) {
      this.sortAsc = !this.sortAsc;
    } else {
      this.sortField = field;
      this.sortAsc = true;
    }
    this.applyFilters();
  }

  clearFilters(): void {
    this.searchText = '';
    this.filterProject = null;
    this.filterRole = null;
    this.showUnassignedOnly = false;
    this.sortField = 'name';
    this.sortAsc = true;
    this.applyFilters();
  }

  get hasActiveFilters(): boolean {
    return !!this.searchText || !!this.filterProject || !!this.filterRole || this.showUnassignedOnly;
  }

  openManageDialog(user: UserRow): void {
    this.selectedUser = user;
    this.draftProjectRoles = {};

    const existingRoles = this.assignmentByUser.get(user.id) ?? new Map<string, string>();

    for (const project of this.projects) {
      const projectId = project.Id?.trim();
      if (!projectId)
        continue;

      this.draftProjectRoles[projectId] = existingRoles.get(projectId) ?? null;
    }

    this.isDialogVisible = true;
  }

  closeManageDialog(): void {
    this.isDialogVisible = false;
    this.selectedUser = null;
    this.draftProjectRoles = {};
  }

  getDraftRole(projectId: string): string {
    return this.draftProjectRoles[projectId] ?? '';
  }

  setDraftRole(projectId: string, role: string): void {
    this.draftProjectRoles[projectId] = role || null;
  }

  saveUserPermissions(): void {
    const selectedUser = this.selectedUser;
    if (!selectedUser)
      return;

    if (!selectedUser.id?.trim()) {
      this.messageService.add({
        key: 'permissions',
        severity: 'error',
        summary: 'Save Failed',
        detail: 'Cannot save roles because this user is missing an id.',
      });
      return;
    }

    const assignments: ProjectRoleAssignmentDto[] = this.projects
      .filter((project) => !!project.Id)
      .map((project) => {
        const projectId = project.Id!;
        const role = this.draftProjectRoles[projectId];

        return {
          ProjectId: projectId,
          ProjectName: project.Title,
          Roles: role ? [role] : [],
        };
      });

    this.isSaving = true;
    this.usersService.setUserProjectRoleAssignments({
      UserId: selectedUser.id,
      Assignments: assignments,
    }).subscribe({
      next: () => {
        const newMap = new Map<string, string>();
        for (const [projectId, role] of Object.entries(this.draftProjectRoles)) {
          if (role)
            newMap.set(projectId, role);
        }

        this.assignmentByUser.set(selectedUser.id, newMap);

        this.users = this.users.map((user) => user.id === selectedUser.id
          ? { ...user, assignedCount: newMap.size }
          : user);

        this.applyFilters();
        this.closeManageDialog();

        this.messageService.add({
          key: 'permissions',
          severity: 'success',
          summary: 'Roles Saved',
          detail: `Saved roles for ${selectedUser.name}.`,
        });
      },
      error: () => {
        this.messageService.add({
          key: 'permissions',
          severity: 'error',
          summary: 'Save Failed',
          detail: 'Failed to save project role assignments.',
        });
      },
      complete: () => {
        this.isSaving = false;
      },
    });
  }

  trackByProjectId(_: number, project: ProjectDto): string {
    return project.Id ?? '';
  }
}
