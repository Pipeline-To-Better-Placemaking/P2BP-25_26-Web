import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf } from '@angular/common';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';

import { SelectButtonModule } from 'primeng/selectbutton';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { ListboxModule } from 'primeng/listbox';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import { UserSettingsService } from '../../services/user-settings-service';
import { PasswordService } from '../../services/password-service';
import { AuthService } from '../../services/auth-service';
import { UsersService } from '../../services/users-service';

@Component({
  selector: 'app-user-settings',
  standalone: true,
  templateUrl: './user-settings.html',
  styleUrls: ['./user-settings.scss'],
  imports: [
    NgIf,
    RouterLink,
    FormsModule,
    CardModule,
    InputTextModule,
    ButtonModule,
    SelectButtonModule,
    CheckboxModule,
    PasswordModule,
    MessageModule,
    ListboxModule,
    TableModule,
    TagModule,
    ToastModule,
  ],
  providers: [MessageService],
})
export class UserSettings implements OnInit {
  private static readonly PROFILE_DRAFT_KEY = 'user_settings_profile_draft';

  constructor(
    private userSettingsService: UserSettingsService,
    private passwordService: PasswordService,
    private authService: AuthService,
    private usersService: UsersService,
    private messageService: MessageService
  ) {}

  saving = false;
  settingsError = '';
  settingsSuccess = false;

  model = {
    firstName: '',
    lastName: '',
    email: '',
    theme: 'system',
  };

  themes = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
    { label: 'System', value: 'system' },
  ];

  password = {
    current: '',
    new: '',
    confirm: '',
  };

  passwordError = '';
  passwordSuccess = false;

  assignedProjects: {
    projectId: string;
    name: string;
    role: string;
    notifyOnOwnScan: boolean;
    notifyOnOthersScan: boolean;
    notifyOnScheduledScan: boolean;
    notifyOnSystemToggle: boolean;
    notifyOnHealthAlert: boolean;
    emailPdfOnSystemOff: boolean;
  }[] = [];

  ngOnInit(): void {
    this.clearPassword();
    this.loadProfileDraft();
    this.authService.state$.pipe(take(1)).subscribe((state) => {
      this.model.email = state?.User?.Email ?? '';
      const userId = state?.User?.Id;
      if (userId) {
        this.loadAssignedProjects(userId);
      }
    });

    this.userSettingsService.getMySettings().subscribe({
      next: (settings) => {
        this.model.firstName = settings.FirstName ?? this.model.firstName;
        this.model.lastName = settings.LastName ?? this.model.lastName;
        this.saveProfileDraft();
      },
      error: (err) => {
        console.error(err);
      },
    });
  }

  save(): void {
    this.settingsError = '';
    this.settingsSuccess = false;

    const firstName = this.model.firstName.trim();
    const lastName = this.model.lastName.trim();

    if (!firstName) {
      this.settingsError = 'First name is required.';
      return;
    }

    this.saving = true;
    const payload = {
      FirstName: firstName,
      LastName: lastName,
    };

    this.userSettingsService
      .updateMySettings(payload)
      .subscribe({
        next: () => {
          this.authService.setProfileNames(firstName, lastName);
          this.saveProfileDraft();
          this.settingsSuccess = true;
          this.saving = false;
        },
        error: (err) => {
          this.settingsError =
            typeof err?.error === 'string' ? err.error : 'Failed to save settings.';
          this.saving = false;
        },
      });
  }

  onNotificationPrefChange(project: typeof this.assignedProjects[0]): void {
    this.userSettingsService.updateProjectNotificationPrefs(project.projectId, {
      NotifyOnOwnScan: project.notifyOnOwnScan,
      NotifyOnOthersScan: project.notifyOnOthersScan,
      NotifyOnScheduledScan: project.notifyOnScheduledScan,
      NotifyOnSystemToggle: project.notifyOnSystemToggle,
      NotifyOnHealthAlert: project.notifyOnHealthAlert,
      EmailPdfOnSystemOff: project.emailPdfOnSystemOff,
    }).subscribe({
      next: () => {
        this.messageService.add({ severity: 'success', summary: 'Saved', detail: 'Notification preference updated.', life: 2000 });
      },
      error: () => {
        this.messageService.add({ severity: 'error', summary: 'Error', detail: "Couldn't save preference. Check your connection.", life: 4000 });
      },
    });
  }

  canSubmitPassword(): boolean {
    const c = this.password.current.trim();
    const n = this.password.new.trim();
    const cf = this.password.confirm.trim();

    if (!c || !n || !cf) return false;
    if (n.length < 8) return false;
    if (n !== cf) return false;

    return true;
  }

  updatePassword(): void {
    this.passwordError = '';
    this.passwordSuccess = false;

    const current = this.password.current.trim();
    const next = this.password.new.trim();
    const confirm = this.password.confirm.trim();

    if (next.length < 8) {
      this.passwordError = 'New password must be at least 8 characters.';
      return;
    }
    if (next !== confirm) {
      this.passwordError = 'New password and confirmation do not match.';
      return;
    }

    this.passwordService.changeMyPassword(current, next).subscribe({
      next: () => {
        this.passwordSuccess = true;
        this.clearPassword();
      },
      error: (err) => {
        this.passwordError =
          typeof err?.error === 'string' ? err.error : 'Password update failed.';
      },
    });
  }

  clearPassword(): void {
    this.password = { current: '', new: '', confirm: '' };
  }

  onProfileNameInput(): void {
    this.saveProfileDraft();
  }

  private loadAssignedProjects(userId: string): void {
    this.usersService.getProjectRoleAssignments().subscribe({
      next: (allAssignments) => {
        const mine = allAssignments.find((a) => a.UserId === userId);
        if (!mine?.Assignments) {
          this.assignedProjects = [];
          return;
        }
        this.assignedProjects = mine.Assignments
          .filter((a) => a.Roles?.length > 0)
          .map((a) => ({
            projectId: a.ProjectId || '',
            name: a.ProjectName || a.ProjectId || '(unknown)',
            role: a.Roles[0],
            notifyOnOwnScan: a.NotifyOnOwnScan ?? false,
            notifyOnOthersScan: a.NotifyOnOthersScan ?? false,
            notifyOnScheduledScan: a.NotifyOnScheduledScan ?? false,
            notifyOnSystemToggle: a.NotifyOnSystemToggle ?? false,
            notifyOnHealthAlert: a.NotifyOnHealthAlert ?? false,
            emailPdfOnSystemOff: a.EmailPdfOnSystemOff ?? false,
          }));
      },
      error: (err) => console.error('Failed to load assigned projects', err),
    });
  }

  private saveProfileDraft(): void {
    try {
      localStorage.setItem(
        UserSettings.PROFILE_DRAFT_KEY,
        JSON.stringify({
          firstName: this.model.firstName,
          lastName: this.model.lastName,
        }),
      );
    } catch {
      // Ignore localStorage failures.
    }
  }

  private loadProfileDraft(): void {
    try {
      const raw = localStorage.getItem(UserSettings.PROFILE_DRAFT_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw) as { firstName?: string; lastName?: string };
      if (typeof parsed.firstName === 'string') {
        this.model.firstName = parsed.firstName;
      }
      if (typeof parsed.lastName === 'string') {
        this.model.lastName = parsed.lastName;
      }
    } catch {
      // Ignore parse/localStorage failures.
    }
  }
}
