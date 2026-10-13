import { Router } from "express";
import * as cloudStorageService from "../services/cloudStorageService.js";
import { requireUserOrDeviceAuth } from "../middleware/requireUserOrDeviceAuth.js";

export const cloudStorageRouter = Router();

// Matches CloudStorageController: [Authorize(AuthenticationSchemes = "UserJwt,DeviceApiKey")],
// authenticated-only, no permission check - accepts either a user JWT or a device API key
// (so Jetson devices can request their own signed upload URLs), via requireUserOrDeviceAuth.
cloudStorageRouter.use(requireUserOrDeviceAuth);

cloudStorageRouter.post("/request-upload", async (req, res, next) => {
  try {
    const { PathFromRoot, FileName, Extension, SizeBytes } = req.body ?? {};
    const result = await cloudStorageService.createSignedUploadUrl({ PathFromRoot, FileName, Extension, SizeBytes });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof cloudStorageService.ValidationError) {
      res.status(400).json({ Message: err.message });
      return;
    }
    next(err);
  }
});

cloudStorageRouter.post("/request-download", async (req, res, next) => {
  try {
    const { PathFromRoot } = req.body ?? {};
    const result = await cloudStorageService.createSignedDownloadUrl({ PathFromRoot });
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof cloudStorageService.ValidationError) {
      res.status(400).json({ Message: err.message });
      return;
    }
    next(err);
  }
});

// Not ported: CloudStorageController.ConfirmUpload. It validates the object path (now
// available here via cloudStorageService.buildObjectPath) and then calls MediaService.Create
// to persist a database media record - MediaService and the `media` resource haven't been
// ported to this server yet, so there is nothing for this endpoint to create. Add a
// `POST /confirm-upload` route here once media.routes.ts / mediaService.ts exist.
