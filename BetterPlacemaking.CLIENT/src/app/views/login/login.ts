import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { AuthService } from '../../services/auth-service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    CardModule,
    CheckboxModule,
  ],
  templateUrl: './login.html',
})
export class Login {
  public constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly fb: FormBuilder
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
    });

    this.signupForm = this.fb.group({
      firstName: ['', [Validators.required]],
      lastName: ['', [Validators.required]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required]],
    });
  }

  public isSignup = false;
  public submitting = false;

  public readonly loginForm;
  public readonly signupForm;

  public toggleMode(): void {
    this.isSignup = !this.isSignup;
  }

  public submitLogin(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.submitting = true;

    const email = this.loginForm.value.email ?? '';
    const password = this.loginForm.value.password ?? '';

    this.authService.login(email, password).subscribe({
      next: (resp) => {
        console.log(resp);
        if (!resp.Success) {
          this.submitting = false;
          return;
        }

        this.router.navigateByUrl('/projects');
        this.submitting = false;
      },
      error: () => {
        this.submitting = false;
      },
    });
  }

  public submitSignup(): void {
    if (this.signupForm.invalid) {
      this.signupForm.markAllAsTouched();
      return;
    }

    this.submitting = true;

    const firstName = this.signupForm.value.firstName ?? '';
    const lastName = this.signupForm.value.lastName ?? '';
    const email = this.signupForm.value.email ?? '';
    const password = this.signupForm.value.password ?? '';

    this.authService.register(firstName, lastName, email, password).subscribe({
      next: () => {
        this.isSignup = false;
        this.submitting = false;
      },
      error: (e) => {
        this.submitting = false;
      },
    });
  }
}
