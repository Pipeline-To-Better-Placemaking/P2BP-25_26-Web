export interface HealthReport {
    Timestamp: number;
    Services?: Record<string, ServiceStatus> | null;
	Cameras?: Record<string, CameraInfo> | null;
    System?: SystemInfo | null;
    IntrinsicsCalibration?: Record<string, IntrinsicsCalibrationState> | null;

    Lidars?: Record<string, LidarInfo> | null;
    PiCompanion?: PiCompanionInfo | null;
}

export interface ServiceStatus {
	Active?: string | null;
	Sub?: string | null;
}

export interface CameraInfo {
	Mac?: string | null;
	Ip?: string | null;
	Resolution?: number[] | null;
	Enabled: boolean;
}

export interface GpuInfo {
	UtilizationPct: number;
	FrequencyMhz: number;
	TemperatureC: number;
}

export interface MemoryInfo {
	UsedMb: number;
	TotalMb: number;
}

export interface SystemInfo {
	Gpu?: GpuInfo | null;
	Memory?: MemoryInfo | null;
	Disk?: DiskPartitionInfo[] | null;
	CpuTemperatureC?: number | null;
}

export interface DiskPartitionInfo {
	Path: string;
	TotalMb: number;
	UsedMb: number;
	FreeMb: number;
	UsePct: number;
	Status: string;
	DeletedFiles: number;
}

export interface IntrinsicsCalibrationState {
	Status: string;
	SightingsCollected: number;
	CoverageGrid: number[];
	SuggestedRegion?: string | null;
	SuggestedTilt?: string | null;
	CurrentRmse: number;
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
