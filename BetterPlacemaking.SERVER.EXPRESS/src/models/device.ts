/**
 * Device Config/HealthReport shapes ported verbatim (field-for-field, PascalCase)
 * from the Angular client's models/jetson-dtos/*.ts, which itself mirrors the
 * ASP.NET Models/JetsonDTOs/Config.cs and HealthReport.cs exactly. This server
 * treats both as opaque-ish structured data - no CV/lidar logic is implemented
 * here, only passthrough storage (that logic lives in later migration phases).
 */

export interface CharucoPoint {
  X: number;
  Y: number;
}

export interface CharucoReferencePoints {
  P1?: CharucoPoint | null;
  P2?: CharucoPoint | null;
}

export interface CharucoBoardDetails {
  SquaresX: number;
  SquaresY: number;
  SquareSize: number;
  ArucoSize: number;
  Dictionary?: string | null;
}

export interface CharucoBoardConfig {
  ReferencePoints?: CharucoReferencePoints | null;
  Board?: CharucoBoardDetails | null;
  BeginScanning: boolean;
}

export interface ArucoLockConfig {
  BeginScanning: boolean;
  ArucoDict?: string | null;
  MinFrames?: number | null;
  MaxSecondsPerCam?: number | null;
  Status?: string | null;
  LastRunUnix?: number | null;
}

export interface IntrinsicsConfig {
  BeginCalibration: boolean;
  ModelId?: string | null;
  PerUnitOverrideMacs?: string[] | null;
  MinSightings?: number | null;
  GridCells?: number | null;
}

export interface TrackingConfig {
  Enabled: boolean;
  Model?: string | null;
  ConfidenceThreshold: number;
  MaxFps: number;
}

export interface CameraConfig {
  Resolution?: string | null;
  Framerate: number;
  Codec?: string | null;
}

export type TrackingCamerasConfig = Record<string, boolean>;

export interface Config {
  Tracking?: TrackingConfig | null;
  Camera?: CameraConfig | null;
  CharucoBoard?: CharucoBoardConfig | null;
  ArucoLock?: ArucoLockConfig | null;
  Intrinsics?: IntrinsicsConfig | null;
  TrackingCameras?: TrackingCamerasConfig | null;
  HeartbeatInterval: number;
  Version?: string | null;
}

export interface ServiceStatus {
  Active: boolean;
  Sub?: string | null;
}

export interface CameraInfo {
  Mac?: string | null;
  Ip?: string | null;
  Resolution?: number[] | null;
  Enabled: boolean;
}

export interface GpuInfo {
  UtilizationPct?: number | null;
  FrequencyMhz?: number | null;
  TemperatureC?: number | null;
}

export interface MemoryInfo {
  UsedMb?: number | null;
  TotalMb?: number | null;
}

export interface DiskInfo {
  Path?: string | null;
  TotalMb?: number | null;
  UsedMb?: number | null;
  FreeMb?: number | null;
  UsePct?: number | null;
  Status?: string | null;
  DeletedFiles?: number | null;
}

export interface SystemInfo {
  Gpu?: GpuInfo | null;
  Memory?: MemoryInfo | null;
  Disk?: DiskInfo[] | null;
  CpuTemperatureC?: number | null;
}

export interface IntrinsicsCalibrationState {
  Status?: string | null;
  SightingsCollected?: number | null;
  CoverageGrid?: number[] | null;
  SuggestedRegion?: string | null;
  SuggestedTilt?: string | null;
  CurrentRmse?: number | null;
}

export interface LidarInfo {
  SensorId?: string | null;
  Connected: boolean;
  DevicePath?: string | null;
  UsbHint?: string | null;
  LastError?: string | null;
}

export interface PiCompanionInfo {
  Configured: boolean;
  Host?: string | null;
  Reachable: boolean;
  LatencyMs?: number | null;
  LastError?: string | null;
}

export interface HealthReport {
  Timestamp: number;
  Services?: Record<string, ServiceStatus> | null;
  Cameras?: Record<string, CameraInfo> | null;
  System?: SystemInfo | null;
  IntrinsicsCalibration?: Record<string, IntrinsicsCalibrationState> | null;
  Lidars?: Record<string, LidarInfo> | null;
  PiCompanion?: PiCompanionInfo | null;
}

/** Document shape for the `devices` collection. */
export interface DeviceDoc {
  ProjectId?: string | null;
  Name?: string | null;
  Config?: Config | null;
  HealthReport?: HealthReport | null;
  ApiKeyHash?: string | null;
}

export interface Device extends DeviceDoc {
  Id: string;
}

/** Wire DTO - never exposes ApiKeyHash (write-only, hash-only, via the /apikey endpoint). */
export interface DeviceDto {
  Id?: string;
  ProjectId?: string | null;
  Name?: string | null;
  Config?: Config | null;
  HealthReport?: HealthReport | null;
}

export function toDeviceDto(device: Device): DeviceDto {
  return {
    Id: device.Id,
    ProjectId: device.ProjectId ?? null,
    Name: device.Name ?? null,
    Config: device.Config ?? null,
    HealthReport: device.HealthReport ?? null,
  };
}
