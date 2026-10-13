import fs from "node:fs";
import type { WorkstationFileStat, WorkstationFiles } from "./types.js";

/** Today's behavior: plain `node:fs` on the API host's disk. Sync calls are kept deliberately. */
export class LocalFsWorkstation implements WorkstationFiles {
  async exists(path: string): Promise<boolean> {
    return fs.existsSync(path);
  }

  async readText(path: string): Promise<string> {
    return fs.readFileSync(path, "utf-8");
  }

  async readBytes(path: string): Promise<Buffer> {
    return fs.readFileSync(path);
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    fs.writeFileSync(path, data);
  }

  async ensureDir(dir: string): Promise<void> {
    fs.mkdirSync(dir, { recursive: true });
  }

  async remove(path: string): Promise<void> {
    fs.unlinkSync(path);
  }

  async listNames(dir: string): Promise<string[]> {
    return fs.readdirSync(dir);
  }

  async listStats(dir: string): Promise<WorkstationFileStat[]> {
    return fs.readdirSync(dir).map((name) => {
      const stat = fs.statSync(`${dir}/${name}`);
      return { name, size: stat.size, mtimeMs: stat.mtime.getTime() };
    });
  }
}
