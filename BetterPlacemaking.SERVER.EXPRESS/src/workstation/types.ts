/** Thrown by RemoteWorkstation until the workstation integration is built. */
export class NotImplementedError extends Error {
  constructor(message = "workstation integration pending") {
    super(message);
    this.name = "NotImplementedError";
  }
}

export interface WorkstationFileStat {
  name: string;
  size: number;
  mtimeMs: number;
}

/**
 * Every filesystem operation the tracking / rplidar / visualizer / scan-calibration services
 * perform today. Paths are workstation paths (absolute, or relative to the process cwd in
 * local mode) exactly as the services have always passed them to `node:fs`.
 *
 * Covers: tracking positions CSV + track JSONs, rplidar .xyz scans, visualizer upload files
 * (base64-decoded .xyz temp files), and calibration .xyz / combined-output files.
 */
export interface WorkstationFiles {
  /** fs.existsSync */
  exists(path: string): Promise<boolean>;
  /** fs.readFileSync(path, "utf-8"). Rejects if the file is missing. */
  readText(path: string): Promise<string>;
  /** fs.readFileSync(path) */
  readBytes(path: string): Promise<Buffer>;
  /** fs.writeFileSync(path, data). Does NOT create parent directories (see ensureDir). */
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  /** fs.mkdirSync(dir, { recursive: true }) */
  ensureDir(dir: string): Promise<void>;
  /** fs.unlinkSync */
  remove(path: string): Promise<void>;
  /** fs.readdirSync(dir) - entry names only, in directory order. */
  listNames(dir: string): Promise<string[]>;
  /** readdirSync + statSync for every entry in dir. */
  listStats(dir: string): Promise<WorkstationFileStat[]>;
}
