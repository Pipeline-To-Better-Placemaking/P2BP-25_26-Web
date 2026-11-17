/**
 * Workstation folder names: the project's directory and AMC project name on the
 * DeepStream workstation. Same rule as the server (hardware repo
 * `installer/plan/AMC-WEB-PROJECTS.md`, section 3): 1 to 48 characters, lowercase
 * letters, digits and inner hyphens.
 */
export const WORKSTATION_FOLDER_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

export const WORKSTATION_FOLDER_MAX_LENGTH = 48;

export const WORKSTATION_FOLDER_HINT =
  "1 to 48 lowercase letters, digits or inner hyphens. Leave empty to skip workstation setup.";

export function isValidWorkstationFolder(value: string): boolean {
  return WORKSTATION_FOLDER_PATTERN.test(value);
}

/** Folder suggested for a title: lowercase, each run of other characters becomes one hyphen, trimmed, cut to 48. */
export function slugifyWorkstationFolder(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, WORKSTATION_FOLDER_MAX_LENGTH)
    .replace(/-+$/, "");
}
