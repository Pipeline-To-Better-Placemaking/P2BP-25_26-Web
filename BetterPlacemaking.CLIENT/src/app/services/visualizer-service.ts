import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { Observable, catchError } from 'rxjs';
import { ErrorHandlerService } from './error-handler-service';

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

  /** Upload an OBJ file */
  uploadObjFile(file: File): Observable<ObjUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<ObjUploadResponse>(`${this.baseUrl}/upload/obj`, formData)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to upload OBJ file')));
  }

  /** Upload XYZ file(s) */
  uploadXyzFiles(fileA: File, fileB?: File): Observable<UploadResponse> {
    const formData = new FormData();
    formData.append('fileA', fileA);
    if (fileB) {
      formData.append('fileB', fileB);
    }
    return this.http
      .post<UploadResponse>(`${this.baseUrl}/upload/xyz`, formData)
      .pipe(catchError((err) => this.errorHandler.handleError(err, 'Failed to upload XYZ file')));
  }

  /** Upload a PLY file */
  uploadPlyFile(file: File, maxPoints = 0): Observable<UploadResponse> {
    const formData = new FormData();
    formData.append('file', file);
    const params = maxPoints > 0 ? `?maxPoints=${maxPoints}` : '';
    return this.http
      .post<UploadResponse>(`${this.baseUrl}/upload/ply${params}`, formData)
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
}
