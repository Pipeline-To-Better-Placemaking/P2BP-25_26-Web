import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subscription, catchError, map, of, tap } from 'rxjs';
import { AuthService } from './auth-service';
import { UsersService } from './users-service';

@Injectable({ providedIn: 'root' })
export class PermissionService {
  private readonly globalPermissionsSubject = new BehaviorSubject<Set<string>>(new Set<string>());
  private globalPermissionsLoaded = false;

  private readonly projectPermissionSubjects = new Map<string, BehaviorSubject<Set<string>>>();
  private readonly loadedProjectPermissions = new Set<string>();

  private authStateSubscription: Subscription;
  private lastUserId: string | null = null;

  public constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {
    this.authStateSubscription = this.authService.state$.subscribe((state) => {
      const userId = state?.User?.Id?.trim() ?? null;
      if (userId !== this.lastUserId) {
        this.lastUserId = userId;
        this.reset();
      }
    });
  }

  public hasGlobalPermission$(permission: string | string[], mode: 'all' | 'any' = 'all'): Observable<boolean> {
    this.ensureGlobalPermissionsLoaded();
    return this.globalPermissionsSubject.pipe(
      map((permissions) => this.evaluate(permissions, permission, mode)),
    );
  }

  public hasGlobalPermissionFresh$(permission: string | string[], mode: 'all' | 'any' = 'all'): Observable<boolean> {
    return this.usersService.getMyGlobalPermissions().pipe(
      catchError(() => of([] as string[])),
      map((permissions) => this.toPermissionSet(permissions)),
      tap((permissions) => {
        this.globalPermissionsLoaded = true;
        this.globalPermissionsSubject.next(permissions);
      }),
      map((permissions) => this.evaluate(permissions, permission, mode)),
    );
  }

  public hasProjectPermission$(
    projectId: string | null | undefined,
    permission: string | string[],
    mode: 'all' | 'any' = 'all',
  ): Observable<boolean> {
    const normalizedProjectId = projectId?.trim();
    if (!normalizedProjectId) {
      return of(false);
    }

    this.ensureProjectPermissionsLoaded(normalizedProjectId);
    const subject = this.getProjectPermissionSubject(normalizedProjectId);
    return subject.pipe(map((permissions) => this.evaluate(permissions, permission, mode)));
  }

  public hasProjectPermissionFresh$(
    projectId: string | null | undefined,
    permission: string | string[],
    mode: 'all' | 'any' = 'all',
  ): Observable<boolean> {
    const normalizedProjectId = projectId?.trim();
    if (!normalizedProjectId) {
      return of(false);
    }

    return this.usersService.getMyProjectPermissions(normalizedProjectId).pipe(
      catchError(() => of([] as string[])),
      map((permissions) => this.toPermissionSet(permissions)),
      tap((permissions) => {
        this.loadedProjectPermissions.add(normalizedProjectId);
        this.getProjectPermissionSubject(normalizedProjectId).next(permissions);
      }),
      map((permissions) => this.evaluate(permissions, permission, mode)),
    );
  }

  public hasGlobalPermissionSync(permission: string): boolean {
    return this.globalPermissionsSubject.value.has(permission.toLowerCase());
  }

  public hasProjectPermissionSync(projectId: string | null | undefined, permission: string): boolean {
    const normalizedProjectId = projectId?.trim();
    if (!normalizedProjectId) return false;

    const projectPermissions = this.projectPermissionSubjects.get(normalizedProjectId)?.value;
    if (!projectPermissions) return false;

    return projectPermissions.has(permission.toLowerCase());
  }

  public reset(): void {
    this.globalPermissionsLoaded = false;
    this.globalPermissionsSubject.next(new Set<string>());

    this.loadedProjectPermissions.clear();
    this.projectPermissionSubjects.clear();
  }

  private ensureGlobalPermissionsLoaded(): void {
    if (this.globalPermissionsLoaded) return;

    this.globalPermissionsLoaded = true;
    this.usersService
      .getMyGlobalPermissions()
      .pipe(catchError(() => of([] as string[])))
      .subscribe((permissions) => {
        this.globalPermissionsSubject.next(this.toPermissionSet(permissions));
      });
  }

  private ensureProjectPermissionsLoaded(projectId: string): void {
    if (this.loadedProjectPermissions.has(projectId)) return;

    this.loadedProjectPermissions.add(projectId);
    this.usersService
      .getMyProjectPermissions(projectId)
      .pipe(catchError(() => of([] as string[])))
      .subscribe((permissions) => {
        this.getProjectPermissionSubject(projectId).next(this.toPermissionSet(permissions));
      });
  }

  private getProjectPermissionSubject(projectId: string): BehaviorSubject<Set<string>> {
    const existing = this.projectPermissionSubjects.get(projectId);
    if (existing) return existing;

    const created = new BehaviorSubject<Set<string>>(new Set<string>());
    this.projectPermissionSubjects.set(projectId, created);
    return created;
  }

  private toPermissionSet(permissions: string[]): Set<string> {
    const set = new Set<string>();
    for (const permission of permissions) {
      if (!permission) continue;
      set.add(permission.toLowerCase());
    }
    return set;
  }

  private evaluate(
    availablePermissions: Set<string>,
    requiredPermission: string | string[],
    mode: 'all' | 'any',
  ): boolean {
    const required = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
    const normalizedRequired = required
      .map((permission) => permission?.trim().toLowerCase())
      .filter((permission) => !!permission) as string[];

    if (normalizedRequired.length === 0) return true;

    if (mode === 'any') {
      return normalizedRequired.some((permission) => availablePermissions.has(permission));
    }

    return normalizedRequired.every((permission) => availablePermissions.has(permission));
  }
}
