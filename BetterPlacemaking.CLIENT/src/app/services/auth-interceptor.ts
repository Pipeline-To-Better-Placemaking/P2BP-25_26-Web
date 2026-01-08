import { Injectable, inject } from '@angular/core';
import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth-service';

const RETRY_HEADER = 'x-auth-retry';

@Injectable()
export class AuthInterceptor implements HttpInterceptor {
  public constructor(private readonly authService: AuthService) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const isApi = req.url.startsWith(environment.apiBaseUrl);
    const isAuthRefresh = req.url.startsWith(`${environment.apiBaseUrl}/api/auth/refresh`);

    let authReq = req;

    if (isApi) {
      authReq = authReq.clone({ withCredentials: true });

      const token = this.authService.getToken();
      if (token) {
        authReq = authReq.clone({
          setHeaders: { Authorization: `Bearer ${token}` },
        });
      }
    }

    return next.handle(authReq).pipe(
      catchError((err: unknown) => {
        if (!isApi) {
          return throwError(() => err);
        }

        if (!(err instanceof HttpErrorResponse) || err.status !== 401) {
          return throwError(() => err);
        }

        if (isAuthRefresh || authReq.headers.has(RETRY_HEADER)) {
          return throwError(() => err);
        }

        return this.authService.refreshOnce().pipe(
          switchMap((resp) => {
            if (!resp?.Success || !resp.Token) {
              return throwError(() => err);
            }

            const retryReq = req.clone({
              withCredentials: true,
              setHeaders: {
                Authorization: `Bearer ${resp.Token}`,
                [RETRY_HEADER]: '1',
              },
            });

            return next.handle(retryReq);
          }),
          catchError(() => {
            this.authService.logout().subscribe({});
            return throwError(() => err);
          }),
        );
      }),
    );
  }
}
