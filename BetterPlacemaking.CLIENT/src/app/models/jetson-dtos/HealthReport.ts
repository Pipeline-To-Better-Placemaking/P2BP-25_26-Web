export interface HealthReport {
    Timestamp: number;
    Services?: Record<string, ServiceStatus> | null;
	Cameras?: Record<string, CameraInfo> | null;
    System?: SystemInfo | null;
}

export interface ServiceStatus {
	Active?: string | null;
	Sub?: string | null;
}

export interface CameraInfo {
	Mac?: string | null;
	Ip?: string | null;
	Resolution?: number[] | null;
	Online: boolean;
}

export interface GpuInfo {
	UtilizationPct: number;
	FrequencyMhz: number;
}

export interface MemoryInfo {
	UsedMb: number;
	TotalMb: number;
}

export interface SystemInfo {
	Gpu?: GpuInfo | null;
	Memory?: MemoryInfo | null;
}