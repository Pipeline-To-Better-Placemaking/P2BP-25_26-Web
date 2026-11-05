import { useState } from "react";
import { Modal } from "../../components/Modal";
import { HasPermission } from "../../auth/HasPermission";
import { Permissions } from "../../lib/permissions";
import * as deviceApi from "../../services/deviceApi";

interface DeviceApiInfoProps {
  projectId: string;
  deviceId: string;
  onClose: () => void;
}

export function DeviceApiInfo({ projectId, deviceId, onClose }: DeviceApiInfoProps) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generateApiKey() {
    setIsLoading(true);
    setError(null);
    setApiKey(null);
    setCopied(false);
    try {
      const key = await deviceApi.getApiKey(projectId, deviceId);
      setApiKey(key);
    } catch {
      setError("Failed to generate API key. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  function copyApiKey() {
    if (!apiKey) return;
    navigator.clipboard
      .writeText(apiKey)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => setCopied(false));
  }

  return (
    <Modal title="Device API Key" onClose={onClose} widthClassName="max-w-md">
      {error && <p className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {apiKey ? (
        <div>
          <p className="text-sm text-ink">
            This is the new API key for this device. Copy it and store it in a safe place now. You won't be able to
            view it again.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <input
              readOnly
              value={apiKey}
              className="w-full rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-sm text-ink"
            />
            <button
              type="button"
              onClick={copyApiKey}
              aria-label="Copy"
              className="rounded-md border border-slate-300 px-2.5 py-2 text-ink hover:bg-slate-100"
            >
              ⧉
            </button>
          </div>
          {copied && <small className="mt-1 block text-green-600">Copied to clipboard</small>}
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-ink hover:bg-slate-100"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-sm text-ink">
            You can only view a device API key once. Clicking "Generate" will create a new key for this device and
            immediately invalidate any previous key.
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-ink hover:bg-slate-100"
            >
              Cancel
            </button>
            <HasPermission permission={Permissions.Project.DevicesManage} projectId={projectId}>
              <button
                type="button"
                onClick={() => void generateApiKey()}
                disabled={isLoading}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {isLoading ? "Generating…" : "Generate"}
              </button>
            </HasPermission>
          </div>
        </div>
      )}
    </Modal>
  );
}
