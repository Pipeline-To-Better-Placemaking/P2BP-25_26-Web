import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogService, DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { BoardLibraryItem } from '../../../../../models/BoardLibrary';
import { BoardService } from '../../../../../services/board-service';
import { BoardGenerateModal } from '../board-generate-modal/board-generate-modal';

const DEFAULT_DETAIL_LONG_EDGE_MM = 180;
const MIN_DETAIL_EDGE_MM = 40;

type BoardDetailModalData = {
  board?: BoardLibraryItem;
  onBoardUpdated?: (item: BoardLibraryItem) => void;
};

@Component({
  selector: 'app-board-detail-modal',
  standalone: true,
  providers: [DialogService],
  imports: [CommonModule, ButtonModule, TagModule, TooltipModule],
  templateUrl: './board-detail-modal.html',
})
export class BoardDetailModal {
  board: BoardLibraryItem | null = null;
  downloading = false;
  deleting = false;
  editing = false;
  private onBoardUpdated?: (item: BoardLibraryItem) => void;

  constructor(
    private readonly config: DynamicDialogConfig,
    private readonly ref: DynamicDialogRef,
    private readonly dialogService: DialogService,
    private readonly boardService: BoardService,
  ) {
    const data = (this.config.data ?? {}) as BoardDetailModalData;
    this.board = data.board ?? null;
    this.onBoardUpdated = data.onBoardUpdated;
  }

  get svgPreview(): string {
    return this.board?.PreviewSvg ?? '';
  }

  get svgPreviewDataUrl(): string {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(this.svgPreview)}`;
  }

  async downloadPdf(): Promise<void> {
    if (!this.board || this.downloading || this.deleting || this.editing) {
      return;
    }

    this.downloading = true;
    try {
      const { jsPDF } = await import('jspdf');
      const svg = this.svgPreview;
      const { widthMm, heightMm } = this.getBoardSizeMm();
      const pngDataUrl = await this.renderSvgToPng(
        svg,
        Math.max(300, Math.round(widthMm * 8)),
        Math.max(300, Math.round(heightMm * 8)),
      );

      const doc = new jsPDF({
        orientation: widthMm >= heightMm ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [widthMm + 20, heightMm + 20],
      });

      doc.addImage(pngDataUrl, 'PNG', 10, 10, widthMm, heightMm, undefined, 'FAST');
      doc.save(this.pdfFileName);
    } finally {
      this.downloading = false;
    }
  }

  editBoard(): void {
    if (!this.board || this.editing || this.deleting || this.downloading) {
      return;
    }

    const dialogRef = this.dialogService.open(BoardGenerateModal, {
      header: 'Edit Board',
      width: '760px',
      modal: true,
      dismissableMask: true,
      closable: true,
      data: {
        existingBoard: this.board,
        boardId: this.board.Id,
      },
    });

    if (!dialogRef) {
      return;
    }

    this.editing = true;
    let closedWithResult = false;

    dialogRef.onClose.subscribe((result?: { saved?: boolean; item?: BoardLibraryItem }) => {
      closedWithResult = true;
      this.editing = false;

      if (!result?.saved) {
        return;
      }

      if (result.item) {
        this.board = result.item;
        this.onBoardUpdated?.(result.item);
      } else if (this.board) {
        this.onBoardUpdated?.(this.board);
      }
    });

    dialogRef.onDestroy.subscribe(() => {
      if (!closedWithResult) {
        this.editing = false;
      }
    });
  }

  deleteBoard(): void {
    if (!this.board?.Id || this.deleting || this.downloading || this.editing) {
      return;
    }

    const confirmed = confirm('Delete this board from your library? This action cannot be undone.');
    if (!confirmed) {
      return;
    }

    this.deleting = true;
    this.boardService.deleteFromLibrary(this.board.Id).subscribe({
      next: () => {
        this.deleting = false;
        this.ref.close({ deleted: true, id: this.board?.Id ?? null });
      },
      error: () => {
        this.deleting = false;
      },
    });
  }

  private getBoardSizeMm(): { widthMm: number; heightMm: number } {
    if (
      this.board?.Type === 'charuco'
      && this.board.Cols != null
      && this.board.Rows != null
      && this.board.SquareSizeMm != null
      && this.board.SquareSizeMm > 0
    ) {
      return {
        widthMm: Math.max(MIN_DETAIL_EDGE_MM, this.board.Cols * this.board.SquareSizeMm),
        heightMm: Math.max(MIN_DETAIL_EDGE_MM, this.board.Rows * this.board.SquareSizeMm),
      };
    }

    if (this.board?.Type === 'aruco' && this.board.MarkerSizeMm > 0) {
      const edge = Math.max(MIN_DETAIL_EDGE_MM, this.board.MarkerSizeMm);
      return { widthMm: edge, heightMm: edge };
    }

    const aspect = this.previewAspectRatio;
    if (aspect >= 1) {
      return {
        widthMm: DEFAULT_DETAIL_LONG_EDGE_MM,
        heightMm: Math.max(MIN_DETAIL_EDGE_MM, DEFAULT_DETAIL_LONG_EDGE_MM / aspect),
      };
    }

    return {
      widthMm: Math.max(MIN_DETAIL_EDGE_MM, DEFAULT_DETAIL_LONG_EDGE_MM * aspect),
      heightMm: DEFAULT_DETAIL_LONG_EDGE_MM,
    };
  }

  private get previewAspectRatio(): number {
    const match = this.svgPreview.match(/viewBox\s*=\s*"\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)\s*"/i);
    if (!match) {
      return 1;
    }

    const width = Number.parseFloat(match[1]);
    const height = Number.parseFloat(match[2]);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return 1;
    }

    return width / height;
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

  private get pdfFileName(): string {
    const baseName = (this.board?.Nickname ?? '').trim()
      || `board-${new Date().toISOString().slice(0, 10)}`;
    return `${baseName.replace(/[^a-zA-Z0-9_-]+/g, '_')}.pdf`;
  }
}
