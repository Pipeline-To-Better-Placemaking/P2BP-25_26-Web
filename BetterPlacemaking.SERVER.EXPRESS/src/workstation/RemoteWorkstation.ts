import { NotImplementedError, type WorkstationFileStat, type WorkstationFiles } from "./types.js";

export interface RemoteWorkstationOptions {
  baseUrl?: string;
  apiToken?: string;
}

const pending = (): never => {
  throw new NotImplementedError("workstation integration pending");
};

/**
 * STUB - the workstation integration is not built yet. Every method throws NotImplementedError.
 *
 * Intended HTTP API (all requests send `Authorization: Bearer <WORKSTATION_API_TOKEN>` to
 * `WORKSTATION_BASE_URL`; `path` is a URL-encoded query parameter):
 *   exists     -> HEAD   /files?path=...            (200 present, 404 absent)
 *   readText   -> GET    /files?path=...            (body decoded as UTF-8)
 *   readBytes  -> GET    /files?path=...            (raw body)
 *   writeFile  -> PUT    /files?path=...            (raw body)
 *   ensureDir  -> POST   /dirs?path=...
 *   remove     -> DELETE /files?path=...
 *   listNames  -> GET    /dirs?path=...             (JSON string[])
 *   listStats  -> GET    /dirs?path=...&stat=1      (JSON {name,size,mtimeMs}[])
 */
export class RemoteWorkstation implements WorkstationFiles {
  constructor(readonly options: RemoteWorkstationOptions = {}) {}

  async exists(_path: string): Promise<boolean> {
    return pending();
  }
  async readText(_path: string): Promise<string> {
    return pending();
  }
  async readBytes(_path: string): Promise<Buffer> {
    return pending();
  }
  async writeFile(_path: string, _data: string | Uint8Array): Promise<void> {
    return pending();
  }
  async ensureDir(_dir: string): Promise<void> {
    return pending();
  }
  async remove(_path: string): Promise<void> {
    return pending();
  }
  async listNames(_dir: string): Promise<string[]> {
    return pending();
  }
  async listStats(_dir: string): Promise<WorkstationFileStat[]> {
    return pending();
  }
}
