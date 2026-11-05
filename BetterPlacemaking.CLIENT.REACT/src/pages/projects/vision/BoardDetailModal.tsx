import { useState } from "react";
import { Modal } from "../../../components/Modal";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { HasPermission } from "../../../auth/HasPermission";
import { Permissions } from "../../../lib/permissions";
import * as boardLibraryApi from "../../../services/boardLibraryApi";
import type { BoardLibraryItem } from "../../../lib/boardLibraryTypes";
import { BoardGenerateModal } from "./BoardGenerateModal";

/**
 * Ported from the Angular board-detail-modal/{board-detail-modal.ts,.html}.
 * View/download/edit/delete a single saved board. Editing reuses
 * BoardGenerateModal (stacked on top), exactly like the Angular version
 * opening a nested DynamicDialog.
 *
 * Deviation from the Angular source: uses this codebase's ConfirmDialog
 * component for the delete confirmation instead of a native `confirm()`
 * call, matching how DevicesList.tsx confirms deletes elsewhere in the app.
 */

const DEFAULT_DETAIL_LONG_EDGE_MM = 180;
const MIN_DETAIL_EDGE_MM = 40;

function toSvgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load SVG image."));
    img.src = src;
  });
}

async function renderSvgToPng(svg: string, width: number, height: number): Promise<string> {
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const objectUrl = URL.createObjectURL(svgBlob);

  try {
    const image = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas context unavailable");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function previewAspectRatio(svg: string): number {
  const match = svg.match(/viewBox\s*=\s*"\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/i);
  if (!match) return 1;
  const width = Number.parseFloat(match[1]);
  const height = Number.parseFloat(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
  return width / height;
}

function getBoardSizeMm(board: BoardLibraryItem): { widthMm: number; heightMm: number } {
  if (board.Type === "charuco" && board.Cols != null && board.Rows != null && board.SquareSizeMm != null && board.SquareSizeMm > 0) {
    return {
      widthMm: Math.max(MIN_DETAIL_EDGE_MM, board.Cols * board.SquareSizeMm),
      heightMm: Math.max(MIN_DETAIL_EDGE_MM, board.Rows * board.SquareSizeMm),
    };
  }

  if (board.Type === "aruco" && board.MarkerSizeMm > 0) {
    const edge = Math.max(MIN_DETAIL_EDGE_MM, board.MarkerSizeMm);
    return { widthMm: edge, heightMm: edge };
  }

  const aspect = previewAspectRatio(board.PreviewSvg);
  if (aspect >= 1) {
    return { widthMm: DEFAULT_DETAIL_LONG_EDGE_MM, heightMm: Math.max(MIN_DETAIL_EDGE_MM, DEFAULT_DETAIL_LONG_EDGE_MM / aspect) };
  }
  return { widthMm: Math.max(MIN_DETAIL_EDGE_MM, DEFAULT_DETAIL_LONG_EDGE_MM * aspect), heightMm: DEFAULT_DETAIL_LONG_EDGE_MM };
}

function pdfFileName(board: BoardLibraryItem): string {
  const baseName = board.Nickname.trim() || `board-${new Date().toISOString().slice(0, 10)}`;
  return `${baseName.replace(/[^a-zA-Z0-9_-]+/g, "_")}.pdf`;
}

interface BoardDetailModalProps {
  board: BoardLibraryItem;
  projectId?: string | null;
  onClose: () => void;
  onUpdated: (item: BoardLibraryItem) => void;
  onDeleted: (id: string) => void;
}

export function BoardDetailModal({ board: initialBoard, projectId, onClose, onUpdated, onDeleted }: BoardDetailModalProps) {
  const [board, setBoard] = useState(initialBoard);
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const svgPreviewDataUrl = toSvgDataUrl(board.PreviewSvg);

  async function downloadPdf() {
    if (downloading || deleting || editing) return;
    setDownloading(true);
    setError(null);
    try {
      const { jsPDF } = await import("jspdf");
      const { widthMm, heightMm } = getBoardSizeMm(board);
      const pngDataUrl = await renderSvgToPng(board.PreviewSvg, Math.max(300, Math.round(widthMm * 8)), Math.max(300, Math.round(heightMm * 8)));

      const doc = new jsPDF({
        orientation: widthMm >= heightMm ? "landscape" : "portrait",
        unit: "mm",
        format: [widthMm + 20, heightMm + 20],
      });

      doc.addImage(pngDataUrl, "PNG", 10, 10, widthMm, heightMm, undefined, "FAST");
      doc.save(pdfFileName(board));
    } catch {
      setError("Unable to generate board PDF.");
    } finally {
      setDownloading(false);
    }
  }

  function confirmDelete() {
    if (deleting || downloading || editing) return;
    setConfirmingDelete(true);
  }

  async function deleteBoard() {
    setConfirmingDelete(false);
    setDeleting(true);
    setError(null);
    try {
      await boardLibraryApi.deleteFromLibrary(board.Id);
      setDeleting(false);
      onDeleted(board.Id);
      onClose();
    } catch {
      setError("Failed to delete board.");
      setDeleting(false);
    }
  }

  return (
    <>
      <Modal title={board.Nickname || "Board"} onClose={onClose} widthClassName="max-w-2xl">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">Download this board as a PDF, edit it, or remove it from your library.</p>

          {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-slate-100 p-3">
              <div className="text-xs text-ink-muted">Nickname</div>
              <div className="font-semibold text-ink">{board.Nickname}</div>
            </div>
            <div className="rounded-lg bg-slate-100 p-3">
              <div className="text-xs text-ink-muted">Type</div>
              <div className="font-semibold uppercase text-ink">{board.Type}</div>
            </div>
            <div className="rounded-lg bg-slate-100 p-3">
              <div className="text-xs text-ink-muted">Dictionary</div>
              <div className="font-semibold text-ink">{board.Dictionary}</div>
            </div>
            {board.Type === "charuco" && (
              <div className="rounded-lg bg-slate-100 p-3">
                <div className="text-xs text-ink-muted">Grid</div>
                <div className="font-semibold text-ink">
                  {board.Cols} x {board.Rows}
                </div>
              </div>
            )}
            {board.Type === "aruco" && (
              <div className="rounded-lg bg-slate-100 p-3">
                <div className="text-xs text-ink-muted">Marker ID</div>
                <div className="font-semibold text-ink">{board.MarkerId ?? 0}</div>
              </div>
            )}
            {board.Type === "charuco" && (
              <div className="rounded-lg bg-slate-100 p-3">
                <div className="text-xs text-ink-muted">Square size</div>
                <div className="font-semibold text-ink">{board.SquareSizeMm} mm</div>
              </div>
            )}
            <div className="rounded-lg bg-slate-100 p-3">
              <div className="text-xs text-ink-muted">Marker size</div>
              <div className="font-semibold text-ink">{board.MarkerSizeMm} mm</div>
            </div>
            <div className="rounded-lg bg-slate-100 p-3">
              <div className="text-xs text-ink-muted">Created</div>
              <div className="font-semibold text-ink">{new Date(board.CreatedAtUtc).toLocaleString()}</div>
            </div>
          </div>

          <div className="flex items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 p-4">
            <img src={svgPreviewDataUrl} alt="Board preview" className="h-auto max-w-full object-contain" />
          </div>

          <div className="flex gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              disabled={deleting || editing}
              onClick={() => void downloadPdf()}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-60"
            >
              {downloading ? "Downloading…" : "Download PDF"}
            </button>
            <HasPermission permission={Permissions.Project.Update} projectId={projectId ?? undefined}>
              <button
                type="button"
                disabled={deleting || downloading}
                onClick={() => setEditing(true)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-ink hover:bg-slate-100 disabled:opacity-60"
              >
                Edit
              </button>
            </HasPermission>
            <HasPermission permission={Permissions.Project.Update} projectId={projectId ?? undefined}>
              <button
                type="button"
                disabled={editing || downloading}
                onClick={confirmDelete}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </HasPermission>
          </div>
        </div>
      </Modal>

      {editing && (
        <BoardGenerateModal
          existingBoard={board}
          projectId={projectId}
          onClose={() => setEditing(false)}
          onSaved={(saved) => {
            setEditing(false);
            setBoard(saved);
            onUpdated(saved);
          }}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete Board"
          message="Delete this board from your library? This action cannot be undone."
          onConfirm={() => void deleteBoard()}
          onCancel={() => setConfirmingDelete(false)}
        />
      )}
    </>
  );
}
