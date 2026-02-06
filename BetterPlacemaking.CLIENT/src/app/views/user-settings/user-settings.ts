import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf } from '@angular/common';

import { SelectButtonModule } from 'primeng/selectbutton';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { ListboxModule } from 'primeng/listbox';

import { UserSettingsService } from '../../services/user-settings-service';
import { PasswordService } from '../../services/password-service';

@Component({
  selector: 'app-user-settings',
  standalone: true,
  templateUrl: './user-settings.html',
  styleUrls: ['./user-settings.scss'],
  imports: [
    NgIf,
    FormsModule,
    CardModule,
    InputTextModule,
    ButtonModule,
    SelectButtonModule,
    CheckboxModule,
    PasswordModule,
    MessageModule,
    ListboxModule,
  ],
})
export class UserSettings {
  constructor(
    private userSettingsService: UserSettingsService,
    private passwordService: PasswordService
  ) {}

  saving = false;

  model = {
    displayName: '',
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

  assignedProjects = [
    { name: 'UCF Art Gallery' },
    { name: 'Classroom' },
    { name: 'Lake Eola' },
  ];

  save(): void {

    this.saving = true;

    this.userSettingsService
      .updateMySettings({
        displayName: this.model.displayName,
        emailAlerts: this.notifications.emailAlerts,
        scanCompletionAlerts: this.notifications.scanCompletionAlerts,
        changeDetectionAlerts: this.notifications.changeDetectionAlerts,
      })
      .subscribe({
        next: () => {
          this.saving = false;
        },
        error: (err) => {
          console.error(err);
          this.saving = false;
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
}
