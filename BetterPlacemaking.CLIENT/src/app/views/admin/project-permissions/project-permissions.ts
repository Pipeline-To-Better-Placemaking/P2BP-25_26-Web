import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { DialogModule } from 'primeng/dialog';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { AutoCompleteModule } from 'primeng/autocomplete';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { ToastModule } from 'primeng/toast';
import { ConfirmationService, MessageService } from 'primeng/api';
import { forkJoin } from 'rxjs';

import {
  UsersService,
  ApiUser,
  ProjectMemberRoleDto,
} from '../../../services/users-service';
import { PermissionDirective } from '../../../directives/permission.directive';

interface SelectOption {
  label: string;
  value: string;
}

interface AssignedUserRow {
  userId: string;
  name: string;
  email: string;
  role: string;
}

type UserSelection = SelectOption | string | null;

@Component({
  selector: 'app-project-permissions',
  standalone: true,
  imports: [CommonModule, FormsModule, TableModule, DialogModule, ConfirmDialogModule, AutoCompleteModule, SelectModule, ButtonModule, ToastModule, PermissionDirective],
  templateUrl: './project-permissions.html',
  styleUrls: ['./project-permissions.scss'],
})
export class ProjectPermissions implements OnInit {
  projectId = '';
  projectName = '';

  isLoading = false;
  isSaving = false;

  users: ApiUser[] = [];
  roleOptions: SelectOption[] = [];
  assignedUsers: AssignedUserRow[] = [];

  isAddDialogVisible = false;
  selectedUserOption: UserSelection = null;
  filteredUserOptions: SelectOption[] = [];
  selectedRole: string | null = null;
  draftRoleByUserId: Record<string, string> = {};

  constructor(
    private readonly route: ActivatedRoute,
    private readonly usersService: UsersService,
    private readonly messageService: MessageService,
    private readonly confirmationService: ConfirmationService,
  ) {}

  ngOnInit(): void {
    this.route.paramMap.subscribe((params) => {
      this.projectId = (params.get('projectId') ?? '').trim();
      if (!this.projectId) {
        this.messageService.add({
          key: 'projectPermissions',
          severity: 'error',
          summary: 'Missing Project',
          detail: 'Project id is required to manage project permissions.',
        });
        return;
      }

      this.loadData();
    });
  }

  get availableUserOptions(): SelectOption[] {
    const assigned = new Set(this.assignedUsers.map((u) => u.userId));

    return this.users
      .map((u) => {
        const userId = this.pickUserId(u);
        if (!userId || assigned.has(userId))
          return null;

        return {
          value: userId,
          label: this.pickUserLabel(u),
        };
      })
      .filter((option): option is SelectOption => option !== null)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  openAddDialog(): void {
    this.selectedUserOption = null;
    this.filteredUserOptions = this.availableUserOptions;
    this.selectedRole = null;
    this.isAddDialogVisible = true;
  }

  closeAddDialog(): void {
    this.isAddDialogVisible = false;
  }

  addUserRole(): void {
    const selectedUserId = this.resolveSelectedUserId();

    if (!this.projectId || !selectedUserId || !this.selectedRole) {
      this.messageService.add({
        key: 'projectPermissions',
        severity: 'warn',
        summary: 'Missing Selection',
        detail: 'Select both a user and role before adding.',
      });
      return;
    }

    this.isSaving = true;
    this.usersService.setProjectMemberRole(this.projectId, {
      UserId: selectedUserId,
      Role: this.selectedRole,
    }).subscribe({
      next: () => {
        this.closeAddDialog();
        this.loadAssignedUsers();
        this.messageService.add({
          key: 'projectPermissions',
          severity: 'success',
          summary: 'Access Added',
          detail: 'User role was added for this project.',
        });
      },
      error: () => {
        this.messageService.add({
          key: 'projectPermissions',
          severity: 'error',
          summary: 'Add Failed',
          detail: 'Failed to add user role for this project.',
        });
      },
      complete: () => {
        this.isSaving = false;
      },
    });
  }

  private resolveSelectedUserId(): string {
    if (!this.selectedUserOption)
      return '';

    if (typeof this.selectedUserOption === 'string') {
      const raw = this.selectedUserOption.trim();
      if (!raw)
        return '';

      const byValue = this.availableUserOptions.find((option) => option.value === raw);
      if (byValue)
        return byValue.value;

      const byLabel = this.availableUserOptions.find((option) => option.label === raw);
      return byLabel?.value ?? '';
    }

    return this.selectedUserOption.value?.trim() ?? '';
  }

  filterAvailableUsers(event: { query: string }): void {
    const query = (event?.query ?? '').trim().toLowerCase();
    const options = this.availableUserOptions;

    if (!query) {
      this.filteredUserOptions = options;
      return;
    }

    this.filteredUserOptions = options.filter((option) => option.label.toLowerCase().includes(query));
  }

  saveUserRole(row: AssignedUserRow): void {
    const draftRole = (this.draftRoleByUserId[row.userId] ?? '').trim();
    if (!draftRole) {
      this.messageService.add({
        key: 'projectPermissions',
        severity: 'warn',
        summary: 'Missing Role',
        detail: 'Select a role before saving.',
      });
      return;
    }

    this.isSaving = true;
    this.usersService.setProjectMemberRole(this.projectId, {
      UserId: row.userId,
      Role: draftRole,
    }).subscribe({
      next: () => {
        row.role = draftRole;
        this.messageService.add({
          key: 'projectPermissions',
          severity: 'success',
          summary: draftRole ? 'Role Updated' : 'Access Removed',
          detail: draftRole ? `Updated ${row.name}.` : `Removed ${row.name} from this project.`,
        });
      },
      error: () => {
        this.messageService.add({
          key: 'projectPermissions',
          severity: 'error',
          summary: 'Update Failed',
          detail: 'Failed to update role for this user.',
        });
      },
      complete: () => {
        this.isSaving = false;
      },
    });
  }

  confirmRemoveUserRole(row: AssignedUserRow): void {
    this.confirmationService.confirm({
      header: 'Remove User Access',
      message: `Remove ${row.name} from this project?`,
      icon: 'pi pi-exclamation-triangle',
      acceptButtonStyleClass: 'p-button-danger',
      rejectButtonStyleClass: 'p-button-text',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
      accept: () => this.removeUserRole(row),
    });
  }

  private removeUserRole(row: AssignedUserRow): void {
    this.isSaving = true;
    this.usersService.setProjectMemberRole(this.projectId, {
      UserId: row.userId,
      Role: '',
    }).subscribe({
      next: () => {
        this.assignedUsers = this.assignedUsers.filter((u) => u.userId !== row.userId);
        delete this.draftRoleByUserId[row.userId];
        this.messageService.add({
          key: 'projectPermissions',
          severity: 'success',
          summary: 'Access Removed',
          detail: `Removed ${row.name} from this project.`,
        });
      },
      error: () => {
        this.messageService.add({
          key: 'projectPermissions',
          severity: 'error',
          summary: 'Remove Failed',
          detail: 'Failed to remove user from this project.',
        });
      },
      complete: () => {
        this.isSaving = false;
      },
    });
  }

  private loadData(): void {
    this.isLoading = true;

    forkJoin({
      users: this.usersService.getUsers(),
      roles: this.usersService.getProjectRoleOptions(),
      assignments: this.usersService.getProjectMemberRoles(this.projectId),
    }).subscribe({
      next: ({ users, roles, assignments }) => {
        this.users = users;
        this.roleOptions = roles.map((role) => ({ label: role, value: role }));
        this.applyAssignments(assignments);
      },
      error: () => {
        this.messageService.add({
          key: 'projectPermissions',
          severity: 'error',
          summary: 'Load Failed',
          detail: 'Failed to load project permission data.',
        });
      },
      complete: () => {
        this.isLoading = false;
      },
    });
  }

  private loadAssignedUsers(): void {
    this.usersService.getProjectMemberRoles(this.projectId).subscribe({
      next: (assignments) => this.applyAssignments(assignments),
      error: () => {
        this.messageService.add({
          key: 'projectPermissions',
          severity: 'error',
          summary: 'Refresh Failed',
          detail: 'Failed to refresh project assignments.',
        });
      },
    });
  }

  private applyAssignments(assignments: ProjectMemberRoleDto[]): void {
    this.assignedUsers = assignments
      .map((assignment) => {
        const userId = (assignment.UserId ?? '').trim();
        const role = (assignment.Role ?? '').trim();
        const name = `${assignment.FirstName ?? ''} ${assignment.LastName ?? ''}`.trim();

        if (!userId || !role)
          return null;

        return {
          userId,
          name: name || assignment.Email || userId,
          email: assignment.Email ?? '',
          role,
        };
      })
      .filter((row): row is AssignedUserRow => row !== null)
      .sort((a, b) => a.name.localeCompare(b.name));

    this.draftRoleByUserId = {};
    for (const row of this.assignedUsers)
      this.draftRoleByUserId[row.userId] = row.role;
  }

  private pickUserId(user: ApiUser): string | null {
    const id = (user.Id ?? user.id ?? '').trim();
    return id.length > 0 ? id : null;
  }

  private pickUserLabel(user: ApiUser): string {
    const fullName = `${user.FirstName ?? ''} ${user.LastName ?? ''}`.trim();
    if (fullName)
      return `${fullName} (${user.Email ?? 'no email'})`;

    return user.Email ?? 'Unknown User';
  }
}
