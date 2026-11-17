/**
 * Workstation folder names: the project's directory and AMC project name on the
 * DeepStream workstation. One rule on both sides (hardware repo
 * `installer/plan/AMC-WEB-PROJECTS.md`, section 3): 1 to 48 characters, lowercase
 * letters, digits and inner hyphens.
 */
export const WORKSTATION_FOLDER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export function isValidWorkstationFolder(value: unknown): value is string {
  return typeof value === "string" && WORKSTATION_FOLDER_PATTERN.test(value);
}

export type ParsedWorkstationFolder = { ok: true; value: string | null } | { ok: false; message: string };

/** Request value -> stored value: absent, null or "" mean no folder; anything else must match the pattern verbatim. */
export function parseWorkstationFolder(value: unknown): ParsedWorkstationFolder {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (isValidWorkstationFolder(value)) return { ok: true, value };
  return {
    ok: false,
    message: "WorkstationFolder must be 1 to 48 lowercase letters, digits or inner hyphens.",
  };
}
