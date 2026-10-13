import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { devices } from "../db/schema/index.js";
import type { Device } from "../models/device.js";

export function toDevice(row: typeof devices.$inferSelect): Device {
  return {
    Id: row.id,
    ProjectId: row.projectId,
    Name: row.name,
    Config: row.config as Device["Config"],
    HealthReport: row.healthReport as Device["HealthReport"],
    ApiKeyHash: row.apiKeyHash,
  };
}

export async function getDevices(): Promise<Device[]> {
  const rows = await getDb().select().from(devices);
  return rows.map(toDevice);
}

export async function getDevicesByProjectId(projectId: string): Promise<Device[]> {
  if (!projectId?.trim()) return [];
  const rows = await getDb().select().from(devices).where(eq(devices.projectId, projectId));
  return rows.map(toDevice);
}

export async function getDevice(id: string): Promise<Device | null> {
  const [row] = await getDb().select().from(devices).where(eq(devices.id, id)).limit(1);
  return row ? toDevice(row) : null;
}

export interface DeviceInput {
  ProjectId?: string | null;
  Name?: string | null;
  Config?: Device["Config"];
}

/**
 * Fix over the ASP.NET server (see migration plan): always assigns a fresh
 * server-generated id, ignoring any Id the client might send in the create
 * payload - closes the overwrite/clobber bug where a client-supplied Id could
 * silently replace another device's document.
 */
export async function addDevice(input: DeviceInput): Promise<Device> {
  const [row] = await getDb()
    .insert(devices)
    .values({
      projectId: input.ProjectId ?? null,
      name: input.Name ?? null,
      config: (input.Config ?? null) as Record<string, unknown> | null,
      healthReport: null,
      apiKeyHash: null,
    })
    .returning();
  return toDevice(row);
}

/** Preserves ApiKeyHash and HealthReport regardless of the incoming payload - neither is client-writable here. */
export async function updateDevice(id: string, input: DeviceInput): Promise<Device | null> {
  const [row] = await getDb()
    .update(devices)
    .set({
      projectId: input.ProjectId ?? null,
      name: input.Name ?? null,
      config: (input.Config ?? null) as Record<string, unknown> | null,
    })
    .where(eq(devices.id, id))
    .returning();
  return row ? toDevice(row) : null;
}

export async function deleteDevice(id: string): Promise<boolean> {
  const rows = await getDb().delete(devices).where(eq(devices.id, id)).returning({ id: devices.id });
  return rows.length > 0;
}

function computeApiKeyHash(rawKey: string): string {
  return crypto.createHash("sha256").update(rawKey).digest("base64");
}

/** Generates and persists a new API key hash; the raw key is returned exactly once and never stored. */
export async function generateAndUpdateApiKey(id: string): Promise<string | null> {
  const rawKey = crypto.randomBytes(32).toString("base64");
  const hash = computeApiKeyHash(rawKey);
  const rows = await getDb()
    .update(devices)
    .set({ apiKeyHash: hash })
    .where(eq(devices.id, id))
    .returning({ id: devices.id });
  return rows.length > 0 ? rawKey : null;
}
