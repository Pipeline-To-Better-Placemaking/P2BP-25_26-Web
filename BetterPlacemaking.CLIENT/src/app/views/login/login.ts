import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { CheckboxModule } from 'primeng/checkbox';

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
  styleUrl: './login.scss',
})
export class Login {
  private fb = inject(FormBuilder);

  form = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
    remember: [false],
  });

  // Signup form
  signupForm = this.fb.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
    agree: [false, Validators.requiredTrue],
  });

  // Toggle between login / signup
  isSignup = false;

  submitting = false;
  error = '';

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting = true;
    this.error = '';
    // Replace this with your real auth call
    console.log('Login', this.form.value);
    setTimeout(() => (this.submitting = false), 700);
  }

  submitSignup(): void {
    if (this.signupForm.invalid) {
      this.signupForm.markAllAsTouched();
      return;
    }
    this.submitting = true;
    console.log('Signup', this.signupForm.value);
    setTimeout(() => (this.submitting = false), 700);
  }

  toggleMode(): void {
    this.isSignup = !this.isSignup;
    this.error = '';
  }
}
