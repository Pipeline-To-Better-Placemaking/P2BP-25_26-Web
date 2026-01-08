import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';
import { Observable, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ErrorHandlerService {
  private readonly messageService = inject(MessageService);

  showError(detail: string, summary = 'Error'): void {
    const normalized = (detail ?? '').toString().trim();
    this.messageService.add({
      severity: 'error',
      summary,
      detail: normalized || 'Something went wrong.',
      life: 6000,
    });
  }

  handleError(err: unknown, userMessage?: string): Observable<never> {
    const preferred = (userMessage ?? '').toString().trim();
    const extracted = this.extractMessage(err);
    this.showError(preferred || extracted);
    return throwError(() => err);
  }

  private extractMessage(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const payload = err.error;

      if (payload && typeof payload === 'object') {
        const maybeMessage = (payload as { message?: unknown; Message?: unknown }).message ??
          (payload as { message?: unknown; Message?: unknown }).Message;

        if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
          return maybeMessage.trim();
        }
      }

      if (typeof payload === 'string' && payload.trim()) {
        return payload.trim();
      }

      if (typeof err.message === 'string' && err.message.trim()) {
        return err.message.trim();
      }

      return err.status ? `Request failed (${err.status})` : 'Request failed';
    }

    if (typeof err === 'string' && err.trim()) {
      return err.trim();
    }

    if (err && typeof err === 'object') {
      const maybeMessage = (err as { message?: unknown }).message;
      if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
        return maybeMessage.trim();
      }
    }

    return 'Something went wrong.';
  }
}
