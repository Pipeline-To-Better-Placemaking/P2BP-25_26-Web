export interface HealthCheck {
    Id?: string | null;
    DeviceId?: string | null;
    ProjectId?: string | null;
    Timestamp: number;
    Services?: Record<string, ServiceStatus> | null;
    System?: SystemInfo | null;
}

export interface ServiceStatus {
	Active?: string | null;
	Sub?: string | null;
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