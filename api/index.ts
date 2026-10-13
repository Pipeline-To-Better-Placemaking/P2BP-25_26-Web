// Vercel serverless entry: the whole Express API is one function. No app.listen and no
// boot-time seeding here (roles are seeded via the DB migration / on demand, not per cold start).
import { createApp } from "../BetterPlacemaking.SERVER.EXPRESS/src/app.js";

const app = createApp();

export default app;
