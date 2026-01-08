import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { environment } from '../../environments/environment';
import { catchError } from 'rxjs';
import { ErrorHandlerService } from './error-handler-service';

@Injectable({
  providedIn: 'root',
})
export class SampleService {
  constructor(
  private readonly http: HttpClient,
	private readonly errorHandler: ErrorHandlerService,
  ) {}

  samplePing() {
    return this.http
		.get(`${environment.apiBaseUrl}/api/Sample/ping`, { responseType: 'text' })
		.pipe(catchError((err) => this.errorHandler.handleError(err, 'Ping failed')));
  }
}
