import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { PermissionService } from '../services/permission-service';

type PermissionRouteData = {
  permission?: string | string[];
  permissionMode?: 'all' | 'any';
  permissionScope?: 'global' | 'project';
};

export const permissionGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const permissionService = inject(PermissionService);
  const data = route.data as PermissionRouteData;
  const permission = data.permission;

  if (!permission || (Array.isArray(permission) && permission.length === 0)) {
    return true;
  }

  const mode = data.permissionMode ?? 'all';
  const projectId = getProjectId(route);
  const denied = router.createUrlTree(['/projects']);

  const allowed$ = data.permissionScope === 'global'
    ? permissionService.hasGlobalPermissionFresh$(permission, mode)
    : permissionService.hasProjectPermissionFresh$(projectId, permission, mode);

  return allowed$.pipe(
    map((allowed) => allowed ? true : denied),
    catchError(() => of(denied)),
  );
};

function getProjectId(route: ActivatedRouteSnapshot): string | null {
  for (const snapshot of route.pathFromRoot) {
    const projectId = snapshot.paramMap.get('projectId')?.trim();
    if (projectId) {
      return projectId;
    }
  }

  return null;
}
