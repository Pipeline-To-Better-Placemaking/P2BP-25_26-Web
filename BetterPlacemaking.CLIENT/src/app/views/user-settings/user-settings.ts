import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgIf } from '@angular/common';

import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { PasswordModule } from 'primeng/password';
import { MessageModule } from 'primeng/message';
import { ListboxModule } from 'primeng/listbox';


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
    CheckboxModule,
    PasswordModule,
    MessageModule,
    ListboxModule
  ],
})
export class UserSettings {

  saving = false;

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

model = {
    displayName: '',
    email: '',
    theme: ''
  };

  themes = [
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
    { label: 'System', value: 'system' }
  ];

canSubmitPassword(): boolean {
  this.passwordError = '';
  this.passwordSuccess = false;

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

  const n = this.password.new.trim();
  const cf = this.password.confirm.trim();

  if (n.length < 8) {
    this.passwordError = 'New password must be at least 8 characters.';
    return;
  }
  if (n !== cf) {
    this.passwordError = 'New password and confirmation do not match.';
    return;
  }

  // placeholder: wire to API later
  this.passwordSuccess = true;
  this.clearPassword();
}

clearPassword(): void {
  this.password = { current: '', new: '', confirm: '' };
}

  save() {
    console.log(this.model);
  }
}