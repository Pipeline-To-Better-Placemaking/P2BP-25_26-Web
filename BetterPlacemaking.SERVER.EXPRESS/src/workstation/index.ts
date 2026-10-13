import { env } from "../config/env.js";
import { LocalFsWorkstation } from "./LocalFsWorkstation.js";
import { RemoteWorkstation } from "./RemoteWorkstation.js";
import type { WorkstationFiles } from "./types.js";

export * from "./types.js";
export { LocalFsWorkstation } from "./LocalFsWorkstation.js";
export { RemoteWorkstation } from "./RemoteWorkstation.js";

let instance: WorkstationFiles | null = null;

/** Selected by WORKSTATION_MODE (`local` default | `remote`). */
export function getWorkstation(): WorkstationFiles {
  if (instance) return instance;
  instance =
    env.workstationMode === "remote"
      ? new RemoteWorkstation({ baseUrl: env.workstationBaseUrl, apiToken: env.workstationApiToken })
      : new LocalFsWorkstation();
  return instance;
}

/** Test hook: install (or clear with null) the workstation returned by getWorkstation(). */
export function setWorkstationForTesting(ws: WorkstationFiles | null): void {
  instance = ws;
}
