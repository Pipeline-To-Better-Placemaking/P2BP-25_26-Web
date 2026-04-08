import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

/** Cluster DTO: nested under scan JSON uses PascalCase (System.Text.Json, PropertyNamingPolicy = null). */
export interface ObstacleCluster {
  Id: number;
  CenterX: number;
  CenterY: number;
  MinX: number;
  MaxX: number;
  MinY: number;
  MaxY: number;
  AvgHeight: number;
  MaxHeight: number;
  PointCount: number;
  Width: number;
  Depth: number;
  Type: string;
  OrientedBbox?: [number, number][];
  RotationDeg?: number;
}

export interface ScanMeta {
  TotalPoints: number;
  FloorZ: number;
  CeilingHeight: number;
  ScanRadius: number;
  FloorThreshold: number;
  CeilingThreshold: number;
}

/** Top-level keys from RplidarController anonymous payloads are camelCase; clusters/meta values use PascalCase fields above. */
export interface RplidarScanData {
  floor: [number, number][];
  obstacles: [number, number, number][];
  clusterPoints: [number, number, number][];
  ceiling: [number, number][];
  wallPoints?: [number, number][];
  clusters: ObstacleCluster[];
  meta: ScanMeta;
}

export interface ScanFileInfo {
  filename: string;
  sizeBytes: number;
  modified: string;
}

export interface FloorplanData {
  floorBounds: { minX: number; maxX: number; minY: number; maxY: number };
  obstacles: ObstacleCluster[];
  meta: ScanMeta;
}

@Injectable({ providedIn: 'root' })
export class RplidarScanService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/rplidar`;

  constructor(private http: HttpClient) {}

  listScans(): Observable<ScanFileInfo[]> {
    return this.http.get<ScanFileInfo[]>(`${this.baseUrl}/scans`);
  }

  loadScanFromCurrentPointCloud(options?: {
    maxFloorPoints?: number;
    maxCeilingPoints?: number;
  }): Observable<RplidarScanData> {
    let params = new HttpParams();
    if (options?.maxFloorPoints !== undefined) {
      params = params.set('maxFloorPoints', options.maxFloorPoints.toString());
    }
    if (options?.maxCeilingPoints !== undefined) {
      params = params.set('maxCeilingPoints', options.maxCeilingPoints.toString());
    }
    return this.http.get<RplidarScanData>(`${this.baseUrl}/from-scan`, { params });
  }

  loadScan(
    filename: string,
    options?: {
      floorThreshold?: number;
      ceilingThreshold?: number;
      maxFloorPoints?: number;
      maxCeilingPoints?: number;
    }
  ): Observable<RplidarScanData> {
    let params = new HttpParams();
    if (options?.floorThreshold !== undefined) {
      params = params.set('floorThreshold', options.floorThreshold.toString());
    }
    if (options?.ceilingThreshold !== undefined) {
      params = params.set('ceilingThreshold', options.ceilingThreshold.toString());
    }
    if (options?.maxFloorPoints !== undefined) {
      params = params.set('maxFloorPoints', options.maxFloorPoints.toString());
    }
    if (options?.maxCeilingPoints !== undefined) {
      params = params.set('maxCeilingPoints', options.maxCeilingPoints.toString());
    }

    return this.http.get<RplidarScanData>(
      `${this.baseUrl}/scans/${encodeURIComponent(filename)}`,
      { params }
    );
  }

  loadObstacles(filename: string): Observable<ObstacleCluster[]> {
    return this.http.get<ObstacleCluster[]>(
      `${this.baseUrl}/scans/${encodeURIComponent(filename)}/obstacles`
    );
  }

  loadFloorplan(filename: string): Observable<FloorplanData> {
    return this.http.get<FloorplanData>(
      `${this.baseUrl}/scans/${encodeURIComponent(filename)}/floorplan`
    );
  }

  uploadScan(file: File): Observable<{ filename: string; meta: ScanMeta; clusterCount: number }> {
    const formData = new FormData();
    formData.append('file', file, file.name);
    return this.http.post<{ filename: string; meta: ScanMeta; clusterCount: number }>(
      `${this.baseUrl}/upload`,
      formData
    );
  }
}
