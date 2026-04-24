import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { BoardService } from '../../../../../services/board-service';
import {
  BoardLibraryItem,
  BoardType,
  BoardUnits,
  SaveBoardLibraryItemRequest,
} from '../../../../../models/BoardLibrary';
import { PermissionDirective } from '../../../../../directives/permission.directive';
import { AR } from 'js-aruco2/src/aruco';
import 'js-aruco2/src/dictionaries/aruco_4x4_1000';
import 'js-aruco2/src/dictionaries/aruco_5x5_1000';
import 'js-aruco2/src/dictionaries/aruco_6x6_1000';

const DICTIONARIES = [
  { label: 'DICT_4X4_50 (recommended)', value: 'DICT_4X4_50' },
  { label: 'DICT_4X4_100', value: 'DICT_4X4_100' },
  { label: 'DICT_5X5_50', value: 'DICT_5X5_50' },
  { label: 'DICT_5X5_100', value: 'DICT_5X5_100' },
  { label: 'DICT_6X6_50', value: 'DICT_6X6_50' },
  { label: 'DICT_6X6_100', value: 'DICT_6X6_100' },
];

const UNITS = [
  { label: 'Millimeters (mm)', value: 'mm' },
  { label: 'Centimeters (cm)', value: 'cm' },
  { label: 'Inches (in)', value: 'in' },
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
  DICT_4X4_50: 'ARUCO_4X4_1000',
  DICT_4X4_100: 'ARUCO_4X4_1000',
  DICT_5X5_50: 'ARUCO_5X5_1000',
  DICT_5X5_100: 'ARUCO_5X5_1000',
  DICT_6X6_50: 'ARUCO_6X6_1000',
  DICT_6X6_100: 'ARUCO_6X6_1000',
};

const CHARUCO_MARKER_TO_SQUARE_RATIO = 0.7;
const DEFAULT_CHARUCO_LONG_EDGE_MM = 180;
const DEFAULT_ARUCO_EDGE_MM = 120;
const MIN_PDF_EDGE_MM = 40;

@Component({
  selector: 'app-board-generate-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    MessageModule,
    InputNumberModule,
    InputTextModule,
    SelectModule,
    TooltipModule,
    PermissionDirective,
  ],
  templateUrl: './board-generate-modal.html',
})
export class BoardGenerateModal implements OnInit {
  boardType: BoardType = 'charuco';
  dictionary = 'DICT_4X4_50';
  cols = 5;
  rows = 7;
  markerId: number | null = 0;
  squareSize: number | null = null;
  markerSize: number | null = null;
  units: BoardUnits | null = null;
  nickname = '';

  generatingPdf = false;
  savingLibrary = false;
  projectId: string | null = null;

  dictionaries = DICTIONARIES;
  unitOptions = UNITS;
  private readonly arucoDictionaryCache = new Map<string, any>();
  private editingBoardId: string | null = null;

  constructor(
    private readonly boardService: BoardService,
    private readonly messageService: MessageService,
    private readonly config: DynamicDialogConfig,
    private readonly ref: DynamicDialogRef,
  ) {}

  ngOnInit(): void {
    const data = (this.config.data ?? {}) as {
      existingBoard?: BoardLibraryItem;
      boardId?: string;
      projectId?: string;
    };

    this.projectId = data.projectId ?? null;

    const existing = data.existingBoard;
    if (!existing) {
      return;
    }

    this.editingBoardId = data.boardId ?? existing.Id ?? null;
    this.boardType = existing.Type;
    this.dictionary = existing.Dictionary;
    this.cols = existing.Cols ?? this.cols;
    this.rows = existing.Rows ?? this.rows;
    this.markerId = existing.MarkerId ?? 0;
    this.squareSize = existing.SquareSize;
    this.markerSize = existing.MarkerSize;
    this.units = existing.Units;
    this.nickname = existing.Nickname;
    this.onDictionaryChange();
  }

  get isEditing(): boolean {
    return this.editingBoardId != null;
  }

  get modalDescriptorText(): string {
    return this.isEditing
      ? 'Update board settings. Save changes to overwrite this board in your library.'
      : 'Configure your board and download a print-ready PDF. Save to your library once real-world size fields are valid.';
  }

  get markerIdMax(): number {
    return MARKER_MAX_BY_DICTIONARY[this.dictionary] ?? 49;
  }

  get isCharuco(): boolean {
    return this.boardType === 'charuco';
  }

  get isAruco(): boolean {
    return this.boardType === 'aruco';
  }

  get hasValidStructure(): boolean {
    if (this.isCharuco) {
      const markerSlots = Math.floor((this.cols * this.rows) / 2);
      return this.cols >= 2 && this.rows >= 2 && markerSlots <= this.markerIdMax + 1;
    }

    return this.markerId != null && this.markerId >= 0 && this.markerId <= this.markerIdMax;
  }

  get hasValidRealWorldSize(): boolean {
    if (this.units == null || this.markerSize == null || this.markerSize <= 0) {
      return false;
    }

    if (this.isCharuco) {
      if (this.squareSize == null || this.squareSize <= 0) {
        return false;
      }

      return this.markerSize < this.squareSize;
    }

    return true;
  }

  get canGeneratePdf(): boolean {
    return this.hasValidStructure && !this.generatingPdf;
  }

  get canSaveToLibrary(): boolean {
    return this.hasValidStructure && this.hasValidRealWorldSize && !this.savingLibrary;
  }

  onDictionaryChange(): void {
    if (this.markerId == null) {
      this.markerId = 0;
      return;
    }

    if (this.markerId > this.markerIdMax) {
      this.markerId = this.markerIdMax;
    }
  }

  setBoardType(type: BoardType): void {
    this.boardType = type;

    if (type === 'aruco' && this.markerId == null) {
      this.markerId = 0;
    }
  }

  get svgPreview(): string {
    if (!this.hasValidStructure) {
      return this.emptyPreviewSvg;
    }

    return this.isCharuco ? this.buildCharucoSvg() : this.buildArucoSvg();
  }

  get svgPreviewDataUrl(): string {
    return this.toSvgDataUrl(this.svgPreview);
  }

  async generateAndDownloadPdf(): Promise<void> {
    if (!this.canGeneratePdf) {
      return;
    }

    this.generatingPdf = true;

    try {
      const { jsPDF } = await import('jspdf');
      const svg = this.svgPreview;
      const { widthMm, heightMm } = this.getPdfBoardSizeMm();
      const scale = 8;
      const pngDataUrl = await this.renderSvgToPng(
        svg,
        Math.max(300, Math.round(widthMm * scale)),
        Math.max(300, Math.round(heightMm * scale)),
      );

      const doc = new jsPDF({
        orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [widthMm + 20, heightMm + 20],
      });

      doc.addImage(pngDataUrl, 'PNG', 10, 10, widthMm, heightMm, undefined, 'FAST');
      doc.save(this.pdfFileName);

      this.messageService.add({
        severity: 'success',
        summary: 'Board Generated',
        detail: this.hasValidRealWorldSize
          ? 'PDF downloaded successfully.'
          : 'PDF downloaded. Enter measured size values afterward to save to library.',
        life: 4000,
      });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Generation Failed',
        detail: 'Unable to generate board PDF.',
        life: 6000,
      });
    } finally {
      this.generatingPdf = false;
    }
  }

  saveToLibrary(): void {
    if (!this.canSaveToLibrary) {
      return;
    }

    this.savingLibrary = true;

    const payload: SaveBoardLibraryItemRequest = {
      Type: this.boardType,
      Nickname: this.cleanNickname(this.nickname),
      Dictionary: this.dictionary,
      Units: this.units!,
      Cols: this.isCharuco ? Math.floor(this.cols) : null,
      Rows: this.isCharuco ? Math.floor(this.rows) : null,
      MarkerId: this.isAruco && this.markerId != null ? Math.floor(this.markerId) : null,
      SquareSize: this.isCharuco ? this.squareSize : null,
      MarkerSize: this.markerSize!,
      PreviewSvg: this.svgPreview,
    };

    const saveRequest = this.editingBoardId == null
      ? this.boardService.saveToLibrary(payload)
      : this.boardService.updateInLibrary(this.editingBoardId, payload);

    saveRequest.subscribe({
      next: (saved) => {
        this.messageService.add({
          severity: 'success',
          summary: this.isEditing ? 'Updated' : 'Saved',
          detail: this.isEditing
            ? 'Board changes saved.'
            : 'Board saved to your library.',
          life: 4000,
        });
        this.savingLibrary = false;
        this.ref.close({ saved: true, updated: this.isEditing, item: saved });
      },
      error: () => {
        this.savingLibrary = false;
      },
    });
  }

  private get emptyPreviewSvg(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="#f4f4f5" /><text x="160" y="92" text-anchor="middle" font-size="12" fill="#71717a">Enter valid board settings to preview</text></svg>`;
  }

  private buildCharucoSvg(): string {
    const cols = Math.max(2, Math.floor(this.cols));
    const rows = Math.max(2, Math.floor(this.rows));
    const cell = 48;
    const width = cols * cell;
    const height = rows * cell;
    const { bitSize } = this.getMarkerDefinition(0);
    const markerModuleCount = bitSize + 2;
    const desiredMarkerSize = cell * CHARUCO_MARKER_TO_SQUARE_RATIO;
    const markerModuleSize = Math.max(1, Math.round(desiredMarkerSize / markerModuleCount));
    const markerSize = markerModuleCount * markerModuleSize;
    const pad = (cell - markerSize) / 2;
    let cells = '';
    let markerCounter = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cell;
        const y = r * cell;
        const dark = (r + c) % 2 === 0;

        cells += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${dark ? '#121212' : '#f6f7f9'}" />`;
        if (dark) continue;
        const markerSvg = this.renderMarkerSvg(x + pad, y + pad, markerSize, markerCounter++);
        cells += markerSvg;
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff" />${cells}</svg>`;
  }

  private buildArucoSvg(): string {
    const { bitSize } = this.getMarkerDefinition(this.markerId ?? 0);
    const moduleCount = bitSize + 2;
    const moduleSize = 30;
    const size = moduleCount * moduleSize;
    const markerValue = this.markerId ?? 0;
    const markerSvg = this.renderMarkerSvg(0, 0, size, markerValue);

    return `<svg xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#ffffff" />${markerSvg}</svg>`;
  }

  private renderMarkerSvg(x: number, y: number, size: number, markerValue: number): string {
    const { bits, bitSize } = this.getMarkerDefinition(markerValue);
    const moduleCount = bitSize + 2;
    const moduleSize = size / moduleCount;

    let bitRects = `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#000000" />`;

    for (let r = 0; r < bitSize; r++) {
      for (let c = 0; c < bitSize; c++) {
        if (bits[r * bitSize + c] !== '1') continue;
        const bx = x + (c + 1) * moduleSize;
        const by = y + (r + 1) * moduleSize;
        bitRects += `<rect x="${bx}" y="${by}" width="${moduleSize}" height="${moduleSize}" fill="#ffffff" />`;
      }
    }

    return bitRects;
  }

  private getMarkerDefinition(markerValue: number): { bits: string; bitSize: number } {
    const opencvDictionaryName = OPENCV_DICTIONARY_BY_NAME[this.dictionary] ?? 'ARUCO_4X4_1000';

    let dictionary = this.arucoDictionaryCache.get(opencvDictionaryName);
    if (!dictionary) {
      dictionary = new AR.Dictionary(opencvDictionaryName);
      this.arucoDictionaryCache.set(opencvDictionaryName, dictionary);
    }

    const codeList = dictionary.codeList as string[];
    const markerId = Math.max(0, Math.floor(markerValue));
    const bits = codeList[markerId] ?? codeList[0] ?? '';
    const nBits = Number(dictionary.nBits ?? 16);
    const bitSize = Math.max(1, Math.round(Math.sqrt(nBits)));
    return { bits, bitSize };
  }

  private async renderSvgToPng(svg: string, width: number, height: number): Promise<string> {
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(svgBlob);

    try {
      const image = await this.loadImage(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Canvas context unavailable');
      }

      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(image, 0, 0, width, height);

      return canvas.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load SVG image.'));
      img.src = src;
    });
  }

  private getRealWorldBoardSizeMm(): { widthMm: number; heightMm: number } {
    const markerSizeMm = this.convertToMm(this.markerSize!, this.units!);

    if (this.isAruco) {
      return { widthMm: markerSizeMm, heightMm: markerSizeMm };
    }

    const squareSizeMm = this.convertToMm(this.squareSize!, this.units!);
    return {
      widthMm: this.cols * squareSizeMm,
      heightMm: this.rows * squareSizeMm,
    };
  }

  private getPdfBoardSizeMm(): { widthMm: number; heightMm: number } {
    if (this.hasValidRealWorldSize) {
      return this.getRealWorldBoardSizeMm();
    }

    if (this.isAruco) {
      return { widthMm: DEFAULT_ARUCO_EDGE_MM, heightMm: DEFAULT_ARUCO_EDGE_MM };
    }

    const cols = Math.max(2, Math.floor(this.cols));
    const rows = Math.max(2, Math.floor(this.rows));
    const scale = DEFAULT_CHARUCO_LONG_EDGE_MM / Math.max(cols, rows);

    return {
      widthMm: Math.max(MIN_PDF_EDGE_MM, cols * scale),
      heightMm: Math.max(MIN_PDF_EDGE_MM, rows * scale),
    };
  }

  private get pdfFileName(): string {
    const baseName = this.cleanNickname(this.nickname)
      ?? `${this.boardType}-board-${new Date().toISOString().slice(0, 10)}`;

    return `${baseName.replace(/[^a-zA-Z0-9_-]+/g, '_')}.pdf`;
  }

  private convertToMm(value: number, units: BoardUnits): number {
    switch (units) {
      case 'mm':
        return value;
      case 'cm':
        return value * 10;
      case 'in':
        return value * 25.4;
    }
  }

  private cleanNickname(raw: string): string | null {
    const cleaned = (raw ?? '').trim();
    return cleaned.length > 0 ? cleaned : null;
  }

  private toSvgDataUrl(svg: string): string {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }
}
