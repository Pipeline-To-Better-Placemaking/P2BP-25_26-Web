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
  ],
})
export class UserSettings implements OnInit {
  private static readonly PROFILE_DRAFT_KEY = 'user_settings_profile_draft';

  constructor(
    private userSettingsService: UserSettingsService,
    private passwordService: PasswordService,
    private authService: AuthService,
    private usersService: UsersService
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

  notifications = {
    emailAlerts: true,
    scanCompletionAlerts: false,
    changeDetectionAlerts: true,
  };

  password = {
    current: '',
    new: '',
    confirm: '',
  };

  passwordError = '';
  passwordSuccess = false;

  assignedProjects: { name: string; role: string }[] = [];

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
        this.notifications.emailAlerts = settings.EmailAlerts ?? this.notifications.emailAlerts;
        this.notifications.scanCompletionAlerts =
          settings.ScanCompletionAlerts ?? this.notifications.scanCompletionAlerts;
        this.notifications.changeDetectionAlerts =
          settings.ChangeDetectionAlerts ?? this.notifications.changeDetectionAlerts;
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
    const payload: {
      FirstName: string;
      LastName: string;
      EmailAlerts: boolean;
      ScanCompletionAlerts: boolean;
      ChangeDetectionAlerts: boolean;
    } = {
      FirstName: firstName,
      LastName: lastName,
      EmailAlerts: this.notifications.emailAlerts,
      ScanCompletionAlerts: this.notifications.scanCompletionAlerts,
      ChangeDetectionAlerts: this.notifications.changeDetectionAlerts,
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

  saveNotifications(): void {
    this.userSettingsService.updateMySettings({
      EmailAlerts: this.notifications.emailAlerts,
      ScanCompletionAlerts: this.notifications.scanCompletionAlerts,
      ChangeDetectionAlerts: this.notifications.changeDetectionAlerts,
    }).subscribe({
      error: (err) => console.error('Failed to save notification settings', err),
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
            name: a.ProjectName || a.ProjectId || '(unknown)',
            role: a.Roles[0],
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
