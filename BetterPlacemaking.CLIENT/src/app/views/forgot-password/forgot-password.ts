import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PasswordService } from '../../services/password-service';

@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, CardModule, InputTextModule, ButtonModule, MessageModule],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
})
export class ForgotPassword {
  constructor(private readonly passwordService: PasswordService) {}

  email = '';
  submitting = false;
  successMessage = '';
  errorMessage = '';

  submit(): void {
    this.successMessage = '';
    this.errorMessage = '';

    const email = this.email.trim();
    if (!email) {
      this.errorMessage = 'Email is required.';
      return;
    }

    this.submitting = true;
    this.passwordService.requestPasswordReset(email).subscribe({
      next: () => {
        this.submitting = false;
        this.successMessage =
          'If an account exists for that email, a password reset link has been sent.';
      },
      error: () => {
        this.submitting = false;
        this.successMessage =
          'If an account exists for that email, a password reset link has been sent.';
      },
    });
  }
}
