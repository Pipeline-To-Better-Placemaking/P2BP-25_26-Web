import { useMemo, useState } from "react";
import { Modal } from "../../../components/Modal";
import { HasPermission } from "../../../auth/HasPermission";
import { Permissions } from "../../../lib/permissions";
import * as boardLibraryApi from "../../../services/boardLibraryApi";
import type { BoardLibraryItem, BoardType, BoardUnits, SaveBoardLibraryItemRequest } from "../../../lib/boardLibraryTypes";
import { getArucoDictionary } from "../../../lib/arucoDictionary";

/**
 * Ported from the Angular board-generate-modal/{board-generate-modal.ts,.html}.
 * Generates a printable ChArUco/ArUco board preview (real marker bit patterns
 * via js-aruco2, same as the Angular client) and either downloads it as a PDF
 * (jsPDF, client-side only) or saves the config to the user's board library
 * via BetterPlacemaking.SERVER.EXPRESS's /api/board-library.
 */

const DICTIONARIES = [
  { label: "DICT_4X4_50 (recommended)", value: "DICT_4X4_50" },
  { label: "DICT_4X4_100", value: "DICT_4X4_100" },
  { label: "DICT_5X5_50", value: "DICT_5X5_50" },
  { label: "DICT_5X5_100", value: "DICT_5X5_100" },
  { label: "DICT_6X6_50", value: "DICT_6X6_50" },
  { label: "DICT_6X6_100", value: "DICT_6X6_100" },
];

const UNITS: { label: string; value: BoardUnits }[] = [
  { label: "Millimeters (mm)", value: "mm" },
  { label: "Centimeters (cm)", value: "cm" },
  { label: "Inches (in)", value: "in" },
];

const MARKER_MAX_BY_DICTIONARY: Record<string, number> = {
  DICT_4X4_50: 49,
  DICT_4X4_100: 99,
  DICT_5X5_50: 49,
  DICT_5X5_100: 99,
  DICT_6X6_50: 49,
  DICT_6X6_100: 99,
};

const OPENCV_DICTIONARY_BY_NAME: Record<string, string> = {
  DICT_4X4_50: "ARUCO_4X4_1000",
  DICT_4X4_100: "ARUCO_4X4_1000",
  DICT_5X5_50: "ARUCO_5X5_1000",
  DICT_5X5_100: "ARUCO_5X5_1000",
  DICT_6X6_50: "ARUCO_6X6_1000",
  DICT_6X6_100: "ARUCO_6X6_1000",
};

const CHARUCO_MARKER_TO_SQUARE_RATIO = 0.7;
const DEFAULT_CHARUCO_LONG_EDGE_MM = 180;
const DEFAULT_ARUCO_EDGE_MM = 120;
const MIN_PDF_EDGE_MM = 40;

function getMarkerDefinition(dictionary: string, markerValue: number): { bits: string; bitSize: number } {
  const opencvDictionaryName = OPENCV_DICTIONARY_BY_NAME[dictionary] ?? "ARUCO_4X4_1000";
  const dict = getArucoDictionary(opencvDictionaryName);
  const codeList = dict.codeList;
  const markerId = Math.max(0, Math.floor(markerValue));
  const bits = codeList[markerId] ?? codeList[0] ?? "";
  const nBits = Number(dict.nBits ?? 16);
  const bitSize = Math.max(1, Math.round(Math.sqrt(nBits)));
  return { bits, bitSize };
}

function renderMarkerSvg(dictionary: string, x: number, y: number, size: number, markerValue: number): string {
  const { bits, bitSize } = getMarkerDefinition(dictionary, markerValue);
  const moduleCount = bitSize + 2;
  const moduleSize = size / moduleCount;

  let bitRects = `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#000000" />`;

  for (let r = 0; r < bitSize; r++) {
    for (let c = 0; c < bitSize; c++) {
      if (bits[r * bitSize + c] !== "1") continue;
      const bx = x + (c + 1) * moduleSize;
      const by = y + (r + 1) * moduleSize;
      bitRects += `<rect x="${bx}" y="${by}" width="${moduleSize}" height="${moduleSize}" fill="#ffffff" />`;
    }
  }

  return bitRects;
}

function buildCharucoSvg(dictionary: string, colsInput: number, rowsInput: number): string {
  const cols = Math.max(2, Math.floor(colsInput));
  const rows = Math.max(2, Math.floor(rowsInput));
  const cell = 48;
  const width = cols * cell;
  const height = rows * cell;
  const { bitSize } = getMarkerDefinition(dictionary, 0);
  const markerModuleCount = bitSize + 2;
  const desiredMarkerSize = cell * CHARUCO_MARKER_TO_SQUARE_RATIO;
  const markerModuleSize = Math.max(1, Math.round(desiredMarkerSize / markerModuleCount));
  const markerSize = markerModuleCount * markerModuleSize;
  const pad = (cell - markerSize) / 2;
  let cells = "";
  let markerCounter = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cell;
      const y = r * cell;
      const dark = (r + c) % 2 === 0;

      cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${dark ? "#121212" : "#f6f7f9"}" />`;
      if (dark) continue;
      cells += renderMarkerSvg(dictionary, x + pad, y + pad, markerSize, markerCounter++);
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff" />${cells}</svg>`;
}

function buildArucoSvg(dictionary: string, markerId: number): string {
  const { bitSize } = getMarkerDefinition(dictionary, markerId);
  const moduleCount = bitSize + 2;
  const moduleSize = 30;
  const size = moduleCount * moduleSize;
  const markerSvg = renderMarkerSvg(dictionary, 0, 0, size, markerId);

  return `<svg xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#ffffff" />${markerSvg}</svg>`;
}

const EMPTY_PREVIEW_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#f4f4f5" /><text x="160" y="92" text-anchor="middle" font-size="12" fill="#71717a">Enter valid board settings to preview</text></svg>';

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

function convertToMm(value: number, units: BoardUnits): number {
  switch (units) {
    case "mm":
      return value;
    case "cm":
      return value * 10;
    case "in":
      return value * 25.4;
  }
}

function cleanNickname(raw: string): string | null {
  const cleaned = raw.trim();
  return cleaned.length > 0 ? cleaned : null;
}

const inputClass =
  "w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-ink focus:border-brand-500 focus:outline-none";

interface BoardGenerateModalProps {
  existingBoard?: BoardLibraryItem;
  projectId?: string | null;
  onClose: () => void;
  onSaved: (item: BoardLibraryItem, wasEditing: boolean) => void;
}

export function BoardGenerateModal({ existingBoard, projectId, onClose, onSaved }: BoardGenerateModalProps) {
  const editingBoardId = existingBoard?.Id ?? null;
  const isEditing = editingBoardId != null;

  const [boardType, setBoardType] = useState<BoardType>(existingBoard?.Type ?? "charuco");
  const [dictionary, setDictionary] = useState(existingBoard?.Dictionary ?? "DICT_4X4_50");
  const [cols, setCols] = useState(existingBoard?.Cols ?? 5);
  const [rows, setRows] = useState(existingBoard?.Rows ?? 7);
  const [markerId, setMarkerId] = useState<number | null>(existingBoard?.MarkerId ?? 0);
  const [squareSize, setSquareSize] = useState<number | null>(existingBoard?.SquareSize ?? null);
  const [markerSize, setMarkerSize] = useState<number | null>(existingBoard?.MarkerSize ?? null);
  const [units, setUnits] = useState<BoardUnits | null>(existingBoard?.Units ?? null);
  const [nickname, setNickname] = useState(existingBoard?.Nickname ?? "");

  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [savingLibrary, setSavingLibrary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isCharuco = boardType === "charuco";
  const isAruco = boardType === "aruco";
  const markerIdMax = MARKER_MAX_BY_DICTIONARY[dictionary] ?? 49;

  const hasValidStructure = isCharuco
    ? cols >= 2 && rows >= 2 && Math.floor((cols * rows) / 2) <= markerIdMax + 1
    : markerId != null && markerId >= 0 && markerId <= markerIdMax;

  const hasValidRealWorldSize = (() => {
    if (units == null || markerSize == null || markerSize <= 0) return false;
    if (isCharuco) {
      if (squareSize == null || squareSize <= 0) return false;
      return markerSize < squareSize;
    }
    return true;
  })();

  const canGeneratePdf = hasValidStructure && !generatingPdf;
  const canSaveToLibrary = hasValidStructure && hasValidRealWorldSize && !savingLibrary;

  const modalDescriptorText = isEditing
    ? "Update board settings. Save changes to overwrite this board in your library."
    : "Configure your board and download a print-ready PDF. Save to your library once real-world size fields are valid.";

  const svgPreview = useMemo(() => {
    if (!hasValidStructure) return EMPTY_PREVIEW_SVG;
    return isCharuco ? buildCharucoSvg(dictionary, cols, rows) : buildArucoSvg(dictionary, markerId ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasValidStructure, isCharuco, dictionary, cols, rows, markerId]);

  const svgPreviewDataUrl = toSvgDataUrl(svgPreview);

  function onDictionaryChange(next: string) {
    setDictionary(next);
    const max = MARKER_MAX_BY_DICTIONARY[next] ?? 49;
    setMarkerId((current) => {
      if (current == null) return 0;
      return current > max ? max : current;
    });
  }

  function setType(type: BoardType) {
    setBoardType(type);
    if (type === "aruco" && markerId == null) setMarkerId(0);
  }

  function getRealWorldBoardSizeMm(): { widthMm: number; heightMm: number } {
    const markerSizeMm = convertToMm(markerSize!, units!);
    if (isAruco) return { widthMm: markerSizeMm, heightMm: markerSizeMm };
    const squareSizeMm = convertToMm(squareSize!, units!);
    return { widthMm: cols * squareSizeMm, heightMm: rows * squareSizeMm };
  }

  function getPdfBoardSizeMm(): { widthMm: number; heightMm: number } {
    if (hasValidRealWorldSize) return getRealWorldBoardSizeMm();
    if (isAruco) return { widthMm: DEFAULT_ARUCO_EDGE_MM, heightMm: DEFAULT_ARUCO_EDGE_MM };

    const c = Math.max(2, Math.floor(cols));
    const r = Math.max(2, Math.floor(rows));
    const scale = DEFAULT_CHARUCO_LONG_EDGE_MM / Math.max(c, r);
    return {
      widthMm: Math.max(MIN_PDF_EDGE_MM, c * scale),
      heightMm: Math.max(MIN_PDF_EDGE_MM, r * scale),
    };
  }

  function pdfFileName(): string {
    const baseName = cleanNickname(nickname) ?? `${boardType}-board-${new Date().toISOString().slice(0, 10)}`;
    return `${baseName.replace(/[^a-zA-Z0-9_-]+/g, "_")}.pdf`;
  }

  async function generateAndDownloadPdf() {
    if (!canGeneratePdf) return;
    setGeneratingPdf(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const { jsPDF } = await import("jspdf");
      const svg = svgPreview;
      const { widthMm, heightMm } = getPdfBoardSizeMm();
      const scale = 8;
      const pngDataUrl = await renderSvgToPng(
        svg,
        Math.max(300, Math.round(widthMm * scale)),
        Math.max(300, Math.round(heightMm * scale)),
      );

      const doc = new jsPDF({
        orientation: widthMm >= heightMm ? "landscape" : "portrait",
        unit: "mm",
        format: [widthMm + 20, heightMm + 20],
      });

      doc.addImage(pngDataUrl, "PNG", 10, 10, widthMm, heightMm, undefined, "FAST");
      doc.save(pdfFileName());

      setSuccessMessage(
        hasValidRealWorldSize
          ? "PDF downloaded successfully."
          : "PDF downloaded. Enter measured size values afterward to save to library.",
      );
    } catch {
      setError("Unable to generate board PDF.");
    } finally {
      setGeneratingPdf(false);
    }
  }

  async function saveToLibrary() {
    if (!canSaveToLibrary) return;
    setSavingLibrary(true);
    setError(null);
    setSuccessMessage(null);

    const payload: SaveBoardLibraryItemRequest = {
      Type: boardType,
      Nickname: cleanNickname(nickname),
      Dictionary: dictionary,
      Units: units!,
      Cols: isCharuco ? Math.floor(cols) : null,
      Rows: isCharuco ? Math.floor(rows) : null,
      MarkerId: isAruco && markerId != null ? Math.floor(markerId) : null,
      SquareSize: isCharuco ? squareSize : null,
      MarkerSize: markerSize!,
      PreviewSvg: svgPreview,
    };

    try {
      const saved = editingBoardId == null
        ? await boardLibraryApi.saveToLibrary(payload)
        : await boardLibraryApi.updateInLibrary(editingBoardId, payload);
      setSavingLibrary(false);
      onSaved(saved, isEditing);
    } catch {
      setError(isEditing ? "Failed to save board changes." : "Failed to save board to library.");
      setSavingLibrary(false);
    }
  }

  return (
    <Modal title={isEditing ? "Edit Board" : "Generate New Board"} onClose={onClose} widthClassName="max-w-3xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">{modalDescriptorText}</p>

        {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {successMessage && <p className="rounded-md bg-green-50 p-3 text-sm text-green-700">{successMessage}</p>}

        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          {/* Left: form fields */}
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div>
              <div className="mb-2 text-sm font-semibold text-ink">Board Type</div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setType("charuco")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    boardType === "charuco" ? "bg-brand-600 text-white" : "bg-slate-100 text-ink hover:bg-slate-200"
                  }`}
                >
                  ChArUco
                </button>
                <button
                  type="button"
                  onClick={() => setType("aruco")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    boardType === "aruco" ? "bg-brand-600 text-white" : "bg-slate-100 text-ink hover:bg-slate-200"
                  }`}
                >
                  ArUco
                </button>
              </div>
            </div>

            <label className="block text-sm font-medium text-ink">
              Dictionary
              <select
                value={dictionary}
                onChange={(e) => onDictionaryChange(e.target.value)}
                className={`mt-1 ${inputClass}`}
              >
                {DICTIONARIES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            {isCharuco && (
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm font-medium text-ink">
                  Columns
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={cols}
                    onChange={(e) => setCols(Number(e.target.value))}
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
                <label className="block text-sm font-medium text-ink">
                  Rows
                  <input
                    type="number"
                    min={2}
                    max={20}
                    value={rows}
                    onChange={(e) => setRows(Number(e.target.value))}
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
              </div>
            )}

            {isAruco && (
              <label className="block text-sm font-medium text-ink">
                Marker ID
                <input
                  type="number"
                  min={0}
                  max={markerIdMax}
                  value={markerId ?? 0}
                  onChange={(e) => setMarkerId(Number(e.target.value))}
                  className={`mt-1 ${inputClass}`}
                />
                <small className="mt-1 block text-xs text-ink-muted">Valid range: 0 to {markerIdMax}</small>
              </label>
            )}

            <label className="block text-sm font-medium text-ink">
              Units <span className="text-red-500">*</span>
              <select
                value={units ?? ""}
                onChange={(e) => setUnits((e.target.value || null) as BoardUnits | null)}
                className={`mt-1 ${inputClass}`}
              >
                <option value="">Select units...</option>
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-3">
              {isCharuco && (
                <label className="block text-sm font-medium text-ink">
                  Square size
                  <input
                    type="number"
                    min={1}
                    step={0.01}
                    placeholder="e.g. 25"
                    value={squareSize ?? ""}
                    onChange={(e) => setSquareSize(e.target.value === "" ? null : Number(e.target.value))}
                    className={`mt-1 ${inputClass}`}
                  />
                </label>
              )}
              <label className={`block text-sm font-medium text-ink ${isAruco ? "col-span-2" : ""}`}>
                Marker size
                <input
                  type="number"
                  min={1}
                  step={0.01}
                  placeholder="e.g. 18"
                  value={markerSize ?? ""}
                  onChange={(e) => setMarkerSize(e.target.value === "" ? null : Number(e.target.value))}
                  className={`mt-1 ${inputClass}`}
                />
              </label>
            </div>

            <label className="block text-sm font-medium text-ink">
              Nickname
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="e.g. Main board 5x7"
                className={`mt-1 ${inputClass}`}
              />
            </label>
          </div>

          {/* Right: live preview */}
          <div className="flex w-full flex-shrink-0 flex-col gap-2 sm:w-56">
            <div className="text-sm font-semibold text-ink">Preview</div>
            {isCharuco && (
              <div className="text-xs text-ink-muted">
                {cols} × {rows} — ChArUco
              </div>
            )}
            {isAruco && <div className="text-xs text-ink-muted">Marker #{markerId ?? 0} — ArUco</div>}
            <div
              className="flex items-center justify-center overflow-auto rounded-lg border border-slate-200 bg-slate-100 p-3"
              style={{ minHeight: 160, maxHeight: 320 }}
            >
              <img src={svgPreviewDataUrl} alt="Board preview" className="h-auto max-w-full object-contain" />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 border-t border-slate-200 pt-4">
          <HasPermission permission={Permissions.Project.Update} projectId={projectId ?? undefined}>
            <button
              type="button"
              disabled={!canSaveToLibrary}
              onClick={() => void saveToLibrary()}
              title="Requires valid real-world size values"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-600/85 disabled:opacity-60"
            >
              {savingLibrary ? "Saving…" : isEditing ? "Save Changes" : "Save to Library"}
            </button>
          </HasPermission>
          <button
            type="button"
            disabled={!canGeneratePdf}
            onClick={() => void generateAndDownloadPdf()}
            title="Creates a print-ready PDF; size fields are optional for generation"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-ink hover:bg-slate-100 disabled:opacity-60"
          >
            {generatingPdf ? "Generating…" : "Generate & Download PDF"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
