import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';
import { AuthService } from '../../services/auth-service';
import { ThemeService } from '../../services/theme-service';

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
    private readonly route: ActivatedRoute,
    private readonly fb: FormBuilder,
    public readonly themeService: ThemeService
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

    this.returnUrl = this.sanitizeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));

    if (this.authService.isAuthenticatedSync()) {
      this.router.navigateByUrl(this.returnUrl ?? '/projects');
    }
  }

  public isSignup = false;
  public submitting = false;
  private readonly returnUrl: string | null;

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

        this.router.navigateByUrl(this.returnUrl ?? '/projects');
        this.submitting = false;
      },
      error: () => {
        this.submitting = false;
      },
    });
  }

  private sanitizeReturnUrl(raw: string | null): string | null {
    if (!raw) return null;

    if (!raw.startsWith('/') || raw.startsWith('//')) return null;
    return raw;
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
