import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, catchError, of } from 'rxjs';
import { HomographyService } from '../services/homography-service';

export const puzzleReadyGuard: CanActivateFn = (route) => {
  const homographyService = inject(HomographyService);
  const router = inject(Router);

  const projectId = route.parent?.paramMap.get('projectId') ?? '';

  return homographyService.getPuzzleWorkspace(projectId).pipe(
    map((workspace) => {
      const allReady = workspace.PuzzlePieces.length > 0 &&
        workspace.PuzzlePieces.every((p) => p.Status === 'ready');

      if (allReady) return true;

      return router.createUrlTree([projectId, 'vision'], {
        queryParams: { puzzleNotReady: '1' },
      });
    }),
    catchError(() => of(router.createUrlTree([projectId, 'vision']))),
  );
};