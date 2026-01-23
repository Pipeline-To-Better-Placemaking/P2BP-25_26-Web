import { inject } from '@angular/core';
import { CanActivateChildFn, CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth-service';

const checkAuthAndRedirect = (url: string) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticatedSync()) {
    return true;
  }

  return router.createUrlTree(['/login'], {
    queryParams: url && url !== '/' ? { returnUrl: url } : undefined,
  });
};

export const authGuard: CanActivateFn = (_route, state) => checkAuthAndRedirect(state.url);

export const authChildGuard: CanActivateChildFn = (_route, state) => checkAuthAndRedirect(state.url);
