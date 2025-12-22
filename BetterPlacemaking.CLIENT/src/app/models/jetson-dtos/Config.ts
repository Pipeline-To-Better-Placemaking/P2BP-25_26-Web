export interface Config {
    Tracking?: TrackingConfig | null;
    Camera?: CameraConfig | null;
    HeartbeatInterval: number;
    Version?: string | null;
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