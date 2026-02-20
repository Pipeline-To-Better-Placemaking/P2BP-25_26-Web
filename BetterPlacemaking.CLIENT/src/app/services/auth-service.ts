import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, catchError, finalize, firstValueFrom, map, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../environments/environment';
import type { AuthResponse, AuthUser, StoredAuth } from '../models/auth';
import { ErrorHandlerService } from './error-handler-service';

const STORAGE_KEY = 'bp_auth';

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  public constructor (
    private readonly http: HttpClient,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  private readonly stateSubject = new BehaviorSubject<StoredAuth | null>(null);
  readonly state$ = this.stateSubject.asObservable();

  private refreshTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private refreshInFlight$: Observable<AuthResponse> | null = null;

  async init(): Promise<void> {
    const stored = this.readStorage();

    if (stored && !this.isExpired(stored.ExpiresAtUtc)) {
      this.setState(stored);
      return;
    }

    // Try to restore the session via refresh-cookie.
    await firstValueFrom(
      this.refreshOnce().pipe(
        map(() => void 0),
        catchError(() => of(void 0)),
      ),
    );
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(
        `${environment.apiBaseUrl}/api/login/authenticate`,
        { email, password },
        { withCredentials: true },
      )
      .pipe(
        tap((resp) => this.applyAuthResponse(resp)),
        catchError((err) => this.errorHandler.handleError(err, 'Login failed')),
      );
  }

  register(firstName: string, lastName: string, email: string, password: string): Observable<unknown> {
    return this.http
		.post(
			`${environment.apiBaseUrl}/api/register`,
			{ FirstName: firstName, LastName: lastName, Email: email, Password: password },
			{ withCredentials: true },
		)
		.pipe(catchError((err) => this.errorHandler.handleError(err, 'Signup failed')));
  }

  logout(): Observable<void> {
    // Always clear local state immediately.
    this.clearState();

    return this.http
      .post(`${environment.apiBaseUrl}/api/auth/logout`, {}, { withCredentials: true })
      .pipe(
        map(() => void 0),
        catchError(() => of(void 0)),
      );
  }

  refreshOnce(): Observable<AuthResponse> {
    if (this.refreshInFlight$) {
      return this.refreshInFlight$;
    }

    this.refreshInFlight$ = this.http
      .post<AuthResponse>(`${environment.apiBaseUrl}/api/auth/refresh`, {}, { withCredentials: true })
      .pipe(
        tap((resp) => this.applyAuthResponse(resp)),
        shareReplay(1),
        finalize(() => {
          this.refreshInFlight$ = null;
        }),
      );

    return this.refreshInFlight$;
  }

  getToken(): string | null {
    return this.stateSubject.value?.Token ?? null;
  }

  isAuthenticatedSync(): boolean {
    const current = this.stateSubject.value;
    return !!current && !this.isExpired(current.ExpiresAtUtc);
  }

  setProfileNames(firstName: string, lastName: string): void {
    const current = this.stateSubject.value;
    if (!current) return;

    const nextUser: AuthUser = {
      ...current.User,
      FirstName: firstName.trim() || null,
      LastName: lastName.trim() || null,
    };

    this.setState({
      ...current,
      User: nextUser,
    });
  }

  private applyAuthResponse(resp: AuthResponse): void {
    if (!resp?.Success || !resp.Token || !resp.ExpiresAtUtc || !resp.User) {
      return;
    }

    const stored: StoredAuth = {
      Token: resp.Token,
      ExpiresAtUtc: resp.ExpiresAtUtc,
      User: resp.User,
    };

    this.setState(stored);
  }

  private setState(state: StoredAuth): void {
    this.writeStorage(state);
    this.stateSubject.next(state);
    this.scheduleRefresh(state.ExpiresAtUtc);
  }

  private clearState(): void {
    if (this.refreshTimer != null) {
      globalThis.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    globalThis.localStorage.removeItem(STORAGE_KEY);
    this.stateSubject.next(null);
  }

  private scheduleRefresh(expiresAtUtc: string): void {
    if (this.refreshTimer != null) {
      globalThis.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    const exp = new Date(expiresAtUtc).getTime();
    const now = Date.now();

    // Refresh 60 seconds early.
    const refreshAt = exp - 60_000;
    const delay = Math.max(0, refreshAt - now);

    this.refreshTimer = globalThis.setTimeout(() => {
      void firstValueFrom(
        this.refreshOnce().pipe(
          catchError(() => {
            this.clearState();
            return of(null);
          }),
        ),
      );
    }, delay);
  }

  private isExpired(expiresAtUtc: string): boolean {
    const exp = new Date(expiresAtUtc).getTime();
    return Number.isNaN(exp) || exp <= Date.now();
  }

  private readStorage(): StoredAuth | null {
    try {
      const raw = globalThis.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as StoredAuth;
    } catch {
      return null;
    }
  }

  private writeStorage(state: StoredAuth): void {
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
}
