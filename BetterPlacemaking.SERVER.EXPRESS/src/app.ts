import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.routes.js";
import { loginRouter } from "./routes/login.routes.js";
import { registerRouter } from "./routes/register.routes.js";
import { passwordRouter } from "./routes/password.routes.js";
import { emailRouter } from "./routes/email.routes.js";
import { userRouter } from "./routes/user.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { projectRouter } from "./routes/project.routes.js";
import { deviceRouter } from "./routes/device.routes.js";
import { boardLibraryRouter } from "./routes/boardLibrary.routes.js";
import { floorplanLibraryRouter } from "./routes/floorplanLibrary.routes.js";
import { trackingRouter } from "./routes/tracking.routes.js";
import { scanDeviceRouter } from "./routes/scanDevice.routes.js";
import { scanScheduleRouter } from "./routes/scanSchedule.routes.js";
import { scanRouter } from "./routes/scan.routes.js";
import { scanCalibrationRouter } from "./routes/scanCalibration.routes.js";
import { homographyRouter } from "./routes/homography.routes.js";
import { intrinsicsRouter } from "./routes/intrinsics.routes.js";
import { cloudStorageRouter } from "./routes/cloudStorage.routes.js";
import { rplidarRouter } from "./routes/rplidar.routes.js";
import { fusionRouter } from "./routes/fusion.routes.js";
import { visualizerRouter } from "./routes/visualizer.routes.js";
import { trackingTicketRouter } from "./routes/trackingTicket.routes.js";
import { errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  // Cloud Run / reverse-proxy deployments sit behind a load balancer; needed for
  // req.secure / X-Forwarded-* to be trusted, mirroring UseForwardedHeaders.
  app.set("trust proxy", true);

  // Default ~100kb body limit is too small for FloorplanLibrary's base64-encoded image
  // uploads (this server has no multipart parser yet - see floorplanLibrary.routes.ts);
  // 35mb accommodates the old server's 25MB image cap plus base64/JSON overhead.
  app.use(express.json({ limit: "35mb" }));
  app.use(cookieParser());

  if (env.allowedOrigins.length > 0) {
    // credentials: true is required for the bp_refresh cookie to work cross-origin;
    // this is incompatible with a wildcard origin, matching the ASP.NET CORS policy.
    app.use(
      cors({
        origin: env.allowedOrigins,
        credentials: true,
      }),
    );
  }

  app.use("/api/auth", authRouter);
  app.use("/api/login", loginRouter);
  app.use("/api/register", registerRouter);
  app.use("/api/password", passwordRouter);
  app.use("/api/email", emailRouter);
  app.use("/api/user", userRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/project", projectRouter);
  app.use("/api/device", deviceRouter);
  app.use("/api/board-library", boardLibraryRouter);
  app.use("/api/floorplan-library", floorplanLibraryRouter);
  app.use("/api/tracking", trackingRouter);
  app.use("/api/scan-device", scanDeviceRouter);
  app.use("/api/scan-schedule", scanScheduleRouter);
  // Mounted after the hyphenated scan-* prefixes above: Express only matches a
  // use() prefix at a "/" boundary, so /api/scan-device never falls through to
  // this router, but keeping the specific mounts first makes that explicit.
  app.use("/api/scan-calibration", scanCalibrationRouter);
  app.use("/api/scan", scanRouter);
  app.use("/api/intrinsics", intrinsicsRouter);
  app.use("/api/homography", homographyRouter);
  app.use("/api/cloud-storage", cloudStorageRouter);
  app.use("/api/rplidar", rplidarRouter);
  app.use("/api/fusion", fusionRouter);
  app.use("/api/visualizer", visualizerRouter);
  app.use("/api/workstation-tracking", trackingTicketRouter);

  app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));

  app.use(errorHandler);

  return app;
}
