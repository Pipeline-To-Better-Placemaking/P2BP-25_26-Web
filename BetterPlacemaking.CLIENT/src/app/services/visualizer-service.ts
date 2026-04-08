import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable, catchError } from 'rxjs';
import { ErrorHandlerService } from './error-handler-service';

/** Matches GET /api/visualizer/points-meta (PascalCase JSON). */
export interface PointsMeta {
  PointCount: number;
  Revision: number;
}

export interface LidarPoint3D {
  X: number;
  Y: number;
  Z: number;
  Intensity: number;
  Classification: number;
  Color?: string;
  Timestamp?: string;
  SensorId?: string;
}

export interface UploadResponse {
  pointCount: number;
  meshGenerated: boolean;
  meshVertexCount: number;
  meshFaceCount: number;
  message: string;
}

export interface ObjUploadResponse {
  fileName: string;
  vertexCount: number;
  faceCount: number;
  pointCloudCount: number;
}

export interface UploadContext {
  projectId?: string;
  projectName?: string;
  /** XYZ file coordinate units; matches gallery-view (RPLidar exports are usually meters). */
  xyzUnits?: 'mm' | 'm';
}

@Injectable({
  providedIn: 'root',
})
export class VisualizerService {
  private readonly baseUrl = `${environment.apiBaseUrl}/api/visualizer`;

  constructor(
    private readonly http: HttpClient,
    private readonly errorHandler: ErrorHandlerService,
  ) {}

  /** Get the current 3D point cloud */
  getPoints(): Observable<LidarPoint3D[]> {
    return this.http
      .get<LidarPoint3D[]>(`${this.baseUrl}/points`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to load point cloud')));
  }

  /** Session revision for polling after device scan ingest (no point payload). */
  getPointsMeta(): Observable<PointsMeta> {
    return this.http.get<PointsMeta>(`${this.baseUrl}/points-meta`);
  }

  /** Upload an OBJ file */
  uploadObjFile(file: File, context?: UploadContext): Observable<ObjUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    const params = this.buildUploadParams(context);
    return this.http
      .post<ObjUploadResponse>(`${this.baseUrl}/upload/obj`, formData, { params })
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to upload OBJ file')));
  }

  /** Upload XYZ file(s). Sends <code>units</code> form field like P2BP-25_26-Visualizer gallery service. */
  uploadXyzFiles(fileA: File, fileB?: File, context?: UploadContext): Observable<UploadResponse> {
    const formData = new FormData();
    formData.append('fileA', fileA);
    if (fileB) {
      formData.append('fileB', fileB);
    }
    if (context?.xyzUnits === 'mm' || context?.xyzUnits === 'm') {
      formData.append('units', context.xyzUnits);
    }
    const params = this.buildUploadParams(context);
    return this.http
      .post<UploadResponse>(`${this.baseUrl}/upload/xyz`, formData, { params })
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to upload XYZ file')));
  }

  /** Upload a PLY file */
  uploadPlyFile(file: File, maxPoints = 0, context?: UploadContext): Observable<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    let params = this.buildUploadParams(context);
    if (maxPoints > 0) {
      params = params.set('maxPoints', `${maxPoints}`);
    }
    return this.http
      .post<UploadResponse>(`${this.baseUrl}/upload/ply`, formData, { params })
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to upload PLY file')));
  }

  /** Generate or retrieve mesh (returns OBJ text) */
  getMesh(forceRegenerate = false): Observable<string> {
    return this.http
      .post(`${this.baseUrl}/geometry/mesh`, { ForceRegenerate: forceRegenerate }, { responseType: 'text' })
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to generate mesh')));
  }

  /** Export point cloud in various formats */
  exportPointCloud(format: 'obj' | 'csv' | 'xyz' | 'xyz-rgb' | 'txt' | 'pts' | 'ply'): Observable<string> {
    return this.http
      .get(`${this.baseUrl}/export/${format}`, { responseType: 'text' })
      .pipe(catchError((err) => this.errorHandler.handleError(err, `Failed to export as ${format}`)));
  }

  /** Clear the current point cloud */
  clearPoints(): Observable<any> {
    return this.http
      .delete(`${this.baseUrl}/points`)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to clear point cloud')));
  }

  private buildUploadParams(context?: UploadContext): HttpParams {
    let params = new HttpParams();
    if (!context) return params;

    if (context.projectId) {
      params = params.set('projectId', context.projectId);
    }
    if (context.projectName) {
      params = params.set('projectName', context.projectName);
    }

    return params;
  }
}
