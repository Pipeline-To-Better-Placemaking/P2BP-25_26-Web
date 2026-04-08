import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { ErrorHandlerService } from './error-handler-service';

@Injectable({ providedIn: 'root' })
export class HomographyService {
  constructor(
    private readonly http: HttpClient,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  public hasLocalHomography(deviceId: string): Observable<boolean> {
    return this.http
      .get<{ HasLocalHomography: boolean }>(`${environment.apiBaseUrl}/api/homography/has-local/${deviceId}`)
      .pipe(
        map((r) => r.HasLocalHomography),
        catchError((err) => this.errorHandler.handleError(err, 'Failed to check homography status')),
      );
  }
}
