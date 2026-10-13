// Seeds a local Firestore EMULATOR through the running Express API so the app has something to show.
// Creates (idempotently): a verified SuperAdmin user, one project, one device. Emulator only - never run against real Firestore.
//
//   1. npx firebase-tools emulators:start --only firestore --project better-placemaking-vision
//   2. npm run dev                     (API on http://localhost:5200)
//   3. FIRESTORE_EMULATOR_HOST=localhost:8080 node scripts/seed-demo.mjs
//
// Login afterwards: demo@example.com / DemoPass123!
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("Refusing to run: FIRESTORE_EMULATOR_HOST is not set (this script must only touch the emulator).");
  process.exit(1);
}

const API = process.env.SEED_API ?? "http://localhost:5200";
const email = "demo@example.com";
const password = "DemoPass123!";

const json = async (path, opts = {}) => {
  const res = await fetch(API + path, { ...opts, headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) } });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
};

initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID ?? "better-placemaking-vision" });
const db = getFirestore();

const reg = await json("/api/register", { method: "POST", body: JSON.stringify({ FirstName: "Demo", LastName: "Admin", Email: email, Password: password }) });
let userId = reg.body?.User?.Id;
if (!userId) {
  const snap = await db.collection("users").where("Email", "==", email).limit(1).get();
  userId = snap.docs[0]?.id;
  console.log("user already existed:", userId);
} else {
  console.log("registered:", userId);
}

// No self-serve admin bootstrap exists, so verify the email and grant SuperAdmin directly.
await db.collection("users").doc(userId).set({ EmailVerified: true, EmailVerificationToken: null }, { merge: true });
await db.collection("user_global_roles").doc(userId).set({ roles: ["SuperAdmin"] }, { merge: true });

const login = await json("/api/login/authenticate", { method: "POST", body: JSON.stringify({ email, password }) });
const token = login.body?.Token;
if (!token) throw new Error("login failed: " + JSON.stringify(login));
const auth = { Authorization: `Bearer ${token}` };

const projects = await json("/api/project", { headers: auth });
let project = Array.isArray(projects.body) ? projects.body.find((p) => p.Title === "Demo Plaza") : null;
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
