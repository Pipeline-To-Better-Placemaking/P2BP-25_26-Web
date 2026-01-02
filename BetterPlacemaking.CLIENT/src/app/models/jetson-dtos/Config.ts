export interface Config {
	Tracking?: TrackingConfig | null;
	Camera?: CameraConfig | null;
	CharucoBoard?: CharucoBoardConfig | null;
	TrackingCameras?: TrackingCamerasConfig | null;
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

export interface CharucoBoardConfig {
	ReferencePoints: CharucoReferencePoints;
	Board: CharucoBoardDetails;
	BeginScanning: boolean;
}

export interface CharucoReferencePoints {
	P1: CharucoPoint;
	P2: CharucoPoint;
}

export interface CharucoPoint {
	x: number;
	y: number;
}

export interface CharucoBoardDetails {
	SquaresX: number;
	SquaresY: number;
	SquareSize: number;
	ArucoSize: number;
}

export interface TrackingCamerasConfig {
	[key: string]: boolean;
}