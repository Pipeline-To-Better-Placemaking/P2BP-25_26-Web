import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ErrorHandlerService } from './error-handler-service';
import {
  FusionRunDto,
  FusionConfigDto,
  TriggerFusionDto,
  UpdateFusionConfigDto,
} from './../models/FusionDtos';

@Injectable({
  providedIn: 'root',
})
export class FusionService {
  constructor(
    private readonly http: HttpClient,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  getHistory(limit = 50): Observable<FusionRunDto[]> {
    return this.http
      .get<FusionRunDto[]>(`${environment.apiBaseUrl}/api/fusion/history`, { params: { limit } })
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load fusion history')));
  }

  triggerFusion(payload: TriggerFusionDto): Observable<FusionRunDto> {
    return this.http
      .post<FusionRunDto>(`${environment.apiBaseUrl}/api/fusion/trigger`, payload)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to trigger fusion')));
  }

  getConfig(): Observable<FusionConfigDto> {
    return this.http
      .get<FusionConfigDto>(`${environment.apiBaseUrl}/api/fusion/config`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load fusion config')));
  }

  updateConfig(payload: UpdateFusionConfigDto): Observable<FusionConfigDto> {
    return this.http
      .put<FusionConfigDto>(`${environment.apiBaseUrl}/api/fusion/config`, payload)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to update fusion config')));
  }
}
