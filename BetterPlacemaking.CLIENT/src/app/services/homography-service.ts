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

  public getPuzzleWorkspace(projectId: string): Observable<PuzzleWorkspaceResponseDto> {
    return this.http
      .get<PuzzleWorkspaceResponseDto>(`${environment.apiBaseUrl}/api/homography/workspace/${projectId}`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load puzzle workspace')));
  }

  public saveGlobalHomographies(projectId: string, payload: object): Observable<object> {
    return this.http
      .post(`${environment.apiBaseUrl}/api/homography/workspace/${projectId}/global-homographies`, payload)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to save puzzle')));
  }

}

export interface PuzzlePieceDto {
  PuzzlePieceId: string;
  DeviceId: string;
  CameraMac: string;
  Status: string;
  PuzzlePieceDownloadUrl: string | null;
  Metadata: {
    HLocalCanvas: number[][];
    SourceFrameSize: number[];
    PuzzlePieceSize: number[];
  } | null;
  Error: string | null;
}

export interface PuzzleWorkspaceResponseDto {
  ProjectId: string;
  PuzzlePieces: PuzzlePieceDto[];
}

