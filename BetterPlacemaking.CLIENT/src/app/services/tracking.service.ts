import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, interval, switchMap, startWith } from 'rxjs';
import { environment } from '../../environments/environment';

/** Web API JSON uses PascalCase (PropertyNamingPolicy = null). */
export interface TrackingPosition {
  GlobalId: number;
  CameraId: string;
  FrameIdx: number;
  Timestamp: string;
  XGround?: number;
  YGround?: number;
  X1: number;
  Y1: number;
  X2: number;
  Y2: number;
  Confidence: number;
}

export interface TrackingPoint3D {
  X: number;
  Y: number;
  Z: number;
}

export interface PathPoint {
  Position: TrackingPoint3D;
  Timestamp: string;
}

export interface TrackingPath {
  GlobalId: number;
  CameraId: string;
  Id: string;
  IndividualId: string;
  Points: PathPoint[];
  StartTime: string;
  EndTime: string;
  FirstSeenFrame: number;
  LastSeenFrame: number;
  NumDetections: number;
}

export interface ActiveTrack {
  GlobalId: number;
  LatestPosition: {
    XGround: number;
    YGround: number;
    Timestamp: string;
  };
}

@Injectable({ providedIn: 'root' })
export class TrackingService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api`;

  constructor(private http: HttpClient) {}

  getRecentPositions(limit: number = 1000): Observable<TrackingPosition[]> {
    return this.http.get<TrackingPosition[]>(`${this.baseUrl}/tracking/positions?limit=${limit}`);
  }

  getAllTracks(): Observable<TrackingPath[]> {
    return this.http.get<TrackingPath[]>(`${this.baseUrl}/tracking/tracks`);
  }

  getTrackByGlobalId(globalId: number): Observable<TrackingPath> {
    return this.http.get<TrackingPath>(`${this.baseUrl}/tracking/tracks/${globalId}`);
  }

  getActiveTracks(seconds: number = 30): Observable<ActiveTrack[]> {
    return this.http.get<ActiveTrack[]>(`${this.baseUrl}/tracking/active?seconds=${seconds}`);
  }

  pollActiveTracks(intervalMs: number, seconds: number = 30): Observable<ActiveTrack[]> {
    return interval(intervalMs).pipe(
      startWith(0),
      switchMap(() => this.getActiveTracks(seconds))
    );
  }

  pollPositions(intervalMs: number, limit: number = 1000): Observable<TrackingPosition[]> {
    return interval(intervalMs).pipe(
      startWith(0),
      switchMap(() => this.getRecentPositions(limit))
    );
  }
}
