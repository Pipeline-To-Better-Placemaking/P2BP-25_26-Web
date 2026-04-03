import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError } from 'rxjs';
import { environment } from '../../environments/environment';
import { ErrorHandlerService } from './error-handler-service';
import { BoardLibraryItem, SaveBoardLibraryItemRequest } from '../models/BoardLibrary';

@Injectable({
  providedIn: 'root',
})
export class BoardService {
  constructor(
    private readonly http: HttpClient,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  getLibrary(): Observable<BoardLibraryItem[]> {
    return this.http
      .get<BoardLibraryItem[]>(`${environment.apiBaseUrl}/api/board-library`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load board library')));
  }

  saveToLibrary(payload: SaveBoardLibraryItemRequest): Observable<BoardLibraryItem> {
    return this.http
      .post<BoardLibraryItem>(`${environment.apiBaseUrl}/api/board-library`, payload)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to save board to library')));
  }

  updateInLibrary(id: string, payload: SaveBoardLibraryItemRequest): Observable<BoardLibraryItem> {
    return this.http
      .put<BoardLibraryItem>(`${environment.apiBaseUrl}/api/board-library/${id}`, payload)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to update board')));
  }

  deleteFromLibrary(id: string): Observable<void> {
    return this.http
      .delete<void>(`${environment.apiBaseUrl}/api/board-library/${id}`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to delete board')));
  }
}
