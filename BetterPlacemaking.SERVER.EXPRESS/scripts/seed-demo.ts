import "dotenv/config";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client.js";
import { userGlobalRoles, users } from "../src/db/schema/index.js";

// Seeds demo data through the running Express API plus the database in DATABASE_URL.
// Creates (idempotently): a verified SuperAdmin user, one project, one device.
// Use a dev/throwaway database - never run this against production.
//
//   1. npm run db:migrate && npm run db:seed-roles     (DATABASE_URL / DATABASE_DIRECT_URL in .env)
//   2. npm run dev                                     (API on http://localhost:5200)
//   3. npm run db:seed-demo
//
// Login afterwards: demo@example.com / DemoPass123!

const API = process.env.SEED_API ?? "http://localhost:5200";
const email = "demo@example.com";
const password = "DemoPass123!";

const json = async (path: string, opts: RequestInit = {}) => {
  const res = await fetch(API + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
};

const db = getDb();

const reg = await json("/api/register", { method: "POST", body: JSON.stringify({ FirstName: "Demo", LastName: "Admin", Email: email, Password: password }) });
let userId: string | undefined = reg.body?.User?.Id;
if (!userId) {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  userId = existing?.id;
  console.log("user already existed:", userId);
} else {
  console.log("registered:", userId);
}
if (!userId) throw new Error("could not register or find the demo user: " + JSON.stringify(reg));

// No self-serve admin bootstrap exists, so verify the email and grant SuperAdmin directly.
await db.update(users).set({ emailVerified: true, emailVerificationToken: null }).where(eq(users.id, userId));
await db
  .insert(userGlobalRoles)
  .values({ userId, roles: ["SuperAdmin"] })
  .onConflictDoUpdate({ target: userGlobalRoles.userId, set: { roles: ["SuperAdmin"], updatedAt: new Date() } });

const login = await json("/api/login/authenticate", { method: "POST", body: JSON.stringify({ email, password }) });
const token = login.body?.Token;
if (!token) throw new Error("login failed: " + JSON.stringify(login));
const auth = { Authorization: `Bearer ${token}` };

const projects = await json("/api/project", { headers: auth });
let project = Array.isArray(projects.body) ? projects.body.find((p: any) => p.Title === "Demo Plaza") : null;
if (!project) {
  project = (
    await json("/api/project", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ Title: "Demo Plaza", Description: "Seeded demo project for frontend walkthrough", Location: "Sample Site" }),
    })
  ).body;
  console.log("created project:", project.Id);
} else {
  console.log("project exists:", project.Id);
}

const devices = await json(`/api/device/project/${project.Id}`, { headers: auth });
if (!Array.isArray(devices.body) || devices.body.length === 0) {
  const d = await json(`/api/device/project/${project.Id}`, { method: "POST", headers: auth, body: JSON.stringify({ Name: "Demo Jetson 01" }) });
  console.log("created device:", d.body?.Id);
} else {
  console.log("devices exist:", devices.body.length);
}

console.log(JSON.stringify({ email, password, projectId: project.Id }));

process.exit(0);
