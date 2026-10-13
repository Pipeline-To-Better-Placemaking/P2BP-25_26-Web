import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback?: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

function optionalInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  port: optionalInt("PORT", 5200),
  nodeEnv: optional("NODE_ENV", "development") as string,
  isProduction: process.env.NODE_ENV === "production",

  // --- Postgres / Supabase (resolved lazily, so boot needs none of these) ---
  databaseUrl: optional("DATABASE_URL"),
  supabaseUrl: optional("SUPABASE_URL"),
  // SUPABASE_SECRET_KEY is the current name; SUPABASE_SERVICE_ROLE_KEY is the legacy alias.
  supabaseSecretKey: optional("SUPABASE_SECRET_KEY") ?? optional("SUPABASE_SERVICE_ROLE_KEY"),
  supabaseStorageBucket: optional("SUPABASE_STORAGE_BUCKET", "media") as string,

  jwtKey: required("JWT_KEY"),
  jwtIssuer: required("JWT_ISSUER"),
  jwtAudience: required("JWT_AUDIENCE"),
  jwtExpiresMinutes: optionalInt("JWT_EXPIRES_MINUTES", 60),

  authRefreshTokenHashKey: optional("AUTH_REFRESH_TOKEN_HASH_KEY"),
  authRefreshTokenDays: optionalInt("AUTH_REFRESH_TOKEN_DAYS", 30),
  authAccessTokenMinutes: process.env.AUTH_ACCESS_TOKEN_MINUTES
    ? Number.parseInt(process.env.AUTH_ACCESS_TOKEN_MINUTES, 10)
    : undefined,

  allowedOrigins: (optional("ALLOWED_ORIGINS", "") as string)
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0),

  apiBaseUrl: optional("API_BASE_URL", "http://localhost:5200") as string,
  appBaseUrl: optional("APP_BASE_URL", "http://localhost:5173") as string,

  mailjetKey: optional("MAILJET_KEY"),
  mailjetSecretKey: optional("MAILJET_SECRET_KEY"),
  mailjetFromEmail: optional("MAILJET_FROM_EMAIL", "lanzzhen@gmail.com") as string,
  mailjetFromName: optional("MAILJET_FROM_NAME", "BetterPlacemaking") as string,

  redisUrl: optional("REDIS_URL"),

  // --- Workstation seam (local disk vs. remote workstation; remote is a stub for now) ---
  workstationMode: (optional("WORKSTATION_MODE", "local") === "remote" ? "remote" : "local") as "local" | "remote",
  workstationBaseUrl: optional("WORKSTATION_BASE_URL"),
  workstationApiToken: optional("WORKSTATION_API_TOKEN"),

  // --- Tracking (mirrors appsettings.json "Tracking" section) ---
  // Tracking data is a filesystem artifact of the offline CV pipeline (CSV of recent
  // detections + one JSON file per finished track), not a database table - see
  // trackingService.ts for the read/parse logic ported from TrackingDataService.cs.
  trackingPositionsCsv: optional("TRACKING_POSITIONS_CSV", "Data/positions.csv") as string,
  trackingTracksDir: optional("TRACKING_TRACKS_DIR", "Data/tracks") as string,
  trackingOffsetX: optionalFloat("TRACKING_OFFSET_X", 0),
  trackingOffsetY: optionalFloat("TRACKING_OFFSET_Y", 0),
  trackingOffsetZ: optionalFloat("TRACKING_OFFSET_Z", 0),
  trackingRotationAngle: optionalFloat("TRACKING_ROTATION_ANGLE", 0),
  trackingScaleX: optionalFloat("TRACKING_SCALE_X", 1),
  trackingScaleZ: optionalFloat("TRACKING_SCALE_Z", 1),

  // --- RplidarScan (mirrors appsettings.json "RplidarScan" section) ---
  // Raw .xyz scan files live on disk under this directory (a filesystem artifact,
  // like Tracking:* above, not a database table) - see rplidarService.ts for
  // the parse/classify/cluster logic ported from RplidarScanService.cs. The
  // threshold/margin values are physical calibration constants (meters, relative
  // to the RPLidar's ceiling-mount height) - see rplidarService.ts for what each
  // one means; defaults here are copied verbatim from appsettings.json.
  rplidarScanDirectory: optional("RPLIDAR_SCAN_DIRECTORY", "Data/rplidar_scans") as string,
  rplidarFloorThreshold: optionalFloat("RPLIDAR_FLOOR_THRESHOLD", -4.3),
  rplidarCeilingThreshold: optionalFloat("RPLIDAR_CEILING_THRESHOLD", -1.0),
  rplidarClusterGridSize: optionalFloat("RPLIDAR_CLUSTER_GRID_SIZE", 0.4),
  rplidarMinClusterPoints: optionalInt("RPLIDAR_MIN_CLUSTER_POINTS", 10),
  rplidarWallMargin: optionalFloat("RPLIDAR_WALL_MARGIN", 0.8),
  rplidarScannerExclusionRadius: optionalFloat("RPLIDAR_SCANNER_EXCLUSION_RADIUS", 2.0),
  rplidarGroundContactMargin: optionalFloat("RPLIDAR_GROUND_CONTACT_MARGIN", 0.9),
  rplidarMaxObstacleDimension: optionalFloat("RPLIDAR_MAX_OBSTACLE_DIMENSION", 5.0),
};

export function refreshTokenHashKey(): string {
  const key = env.authRefreshTokenHashKey ?? env.jwtKey;
  if (!key) {
    throw new Error("Neither AUTH_REFRESH_TOKEN_HASH_KEY nor JWT_KEY is configured.");
  }
  return key;
}

export function accessTokenMinutes(): number {
  return env.authAccessTokenMinutes ?? env.jwtExpiresMinutes;
}
