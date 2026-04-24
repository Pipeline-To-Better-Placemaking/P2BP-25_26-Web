import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  ElementRef,
  Input,
  OnChanges,
  SimpleChanges,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import { ScanRecordDto } from '../../../../services/scan-service';
import { FloorplanItem } from '../../../../services/floorplan-service';
import { PermissionDirective } from '../../../../directives/permission.directive';
import {
  CombineScansRequest,
  ScanCalibrationService
} from '../../../../services/scan-calibration-service';

interface ClickPoint {
  x: number;
  y: number;
}

interface ScanOverlay {
  scanId: string;
  label: string;
  previewUrl: string;
  image: HTMLImageElement | null;
  xTranslation: number;
  yTranslation: number;
  theta: number;
  scale: number;
  opacity: number;
  visible: boolean;
}

interface UploadedOverlayFile {
  id: string;
  name: string;
  file: File;
}

@Component({
  standalone: true,
  selector: 'app-multi-lidar-calibration',
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    PermissionDirective
  ],
  templateUrl: './multi-lidar-calibration.html',
  styleUrls: ['./multi-lidar-calibration.scss']
})
export class MultiLidarCalibration implements AfterViewInit, OnChanges {
  @Input() projectId: string = '';
  @Input() deviceId: string | null = null;
  @Input() floorPlan: FloorplanItem | null = null;
  @Input() scanHistory: ScanRecordDto[] = [];

  @ViewChild('workspaceCanvas') workspaceCanvas?: ElementRef<HTMLCanvasElement>;

  public mode: 'select' | 'calibrate' | 'align' | 'done' = 'select';

  public selectedScanIds: string[] = [];
  public uploadedFiles: UploadedOverlayFile[] = [];
  public selectedUploadedFileIds: string[] = [];

  public calPoints: ClickPoint[] = [];
  public calDistanceMm: number | null = null;
  public scalarMmPerPixel: number | null = null;

  public outputName = 'calibrationScan';
  public saveError: string | null = null;
  public saveSuccess = false;
  public saving = false;
  public uploadMessage: string | null = null;

  public overlays: ScanOverlay[] = [];
  public selectedOverlayIndex = 0;

  private draggingOverlay = false;
  private dragStartMouse: ClickPoint | null = null;
  private dragStartTranslation: ClickPoint | null = null;

  private floorplanImg = new Image();
  public floorplanLoaded = false;

  constructor(private scanCalibrationService: ScanCalibrationService) {}

  ngAfterViewInit(): void {
    this.initCanvas();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['floorPlan']) {
      setTimeout(() => this.initCanvas(), 0);
    }

    queueMicrotask(() => this.draw());
  }

  public get successfulScans(): ScanRecordDto[] {
    return this.scanHistory.filter(
      s => !!s.ObjUrl && ['complete', 'done'].includes((s.Status ?? '').toLowerCase())
    );
  }

  public get selectedScans(): ScanRecordDto[] {
    return this.successfulScans.filter(
      s => !!s.Id && this.selectedScanIds.includes(s.Id)
    );
  }

  public get selectedOverlay(): ScanOverlay | null {
    return this.overlays[this.selectedOverlayIndex] ?? null;
  }

  public isScanSelected(scanId: string): boolean {
    return this.selectedScanIds.includes(scanId);
  }

  public toggleScanSelection(scanId: string): void {
    if (this.selectedScanIds.includes(scanId)) {
      this.selectedScanIds = this.selectedScanIds.filter(id => id !== scanId);
    } else {
      this.selectedScanIds = [...this.selectedScanIds, scanId];
    }

    this.resetOverlayStateOnly();
  }

  public onXyzFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const xyzFiles = files.filter(f => f.name.toLowerCase().endsWith('.xyz'));

    this.uploadedFiles = [
      ...this.uploadedFiles,
      ...xyzFiles.map(file => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        name: file.name,
        file
      }))
    ];

    input.value = '';
  }

  public toggleUploadedFileSelection(id: string): void {
    if (this.selectedUploadedFileIds.includes(id)) {
      this.selectedUploadedFileIds = this.selectedUploadedFileIds.filter(x => x !== id);
    } else {
      this.selectedUploadedFileIds = [...this.selectedUploadedFileIds, id];
    }

    this.resetOverlayStateOnly();
  }

  public isUploadedFileSelected(id: string): boolean {
    return this.selectedUploadedFileIds.includes(id);
  }

  public startScaleCalibration(): void {
    if (!this.floorPlan?.ImageDownloadUrl) {
      this.saveError = 'A floorplan must be selected first.';
      return;
    }

    if (!this.floorplanLoaded) {
      this.saveError = 'The selected floorplan image is still loading.';
      return;
    }

    this.saveError = null;
    this.mode = 'calibrate';
    this.calPoints = [];
    this.scalarMmPerPixel = null;
    this.saveSuccess = false;
    this.draw();
  }

  public finishCalibration(): void {
    this.saveError = null;

    if (this.calPoints.length !== 2) {
      this.saveError = 'Pick two floorplan reference points first.';
      return;
    }

    if (!this.calDistanceMm || this.calDistanceMm <= 0) {
      this.saveError = 'Enter the real-world distance in millimeters.';
      return;
    }

    const [a, b] = this.calPoints;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const pixelDistance = Math.sqrt(dx * dx + dy * dy);

    if (pixelDistance <= 0) {
      this.saveError = 'Invalid calibration points.';
      return;
    }

    this.scalarMmPerPixel = this.calDistanceMm / pixelDistance;
    this.mode = 'select';
    this.draw();
  }

  public async loadSelectedScans(): Promise<void> {
    this.saveError = null;

    if (!this.scalarMmPerPixel) {
      this.saveError = 'Calibrate the floorplan first.';
      return;
    }

    const selectedUploads = this.uploadedFiles.filter(f =>
      this.selectedUploadedFileIds.includes(f.id)
    );

    const totalSelected = this.selectedScanIds.length + selectedUploads.length;

    if (totalSelected < 2) {
      this.saveError = 'Select or upload at least two scans.';
      return;
    }

    this.overlays = [];

    if (this.selectedScanIds.length > 0) {
      if (!this.projectId || !this.deviceId) {
        this.saveError = 'Project/device context missing for history scans.';
        return;
      }

      for (const scan of this.selectedScans) {
        try {
          const previewUrl = this.scanCalibrationService.getPreview(
            this.projectId,
            this.deviceId,
            scan.Id!
          );

          const image = await this.loadImage(previewUrl);

          this.overlays.push({
            scanId: scan.Id!,
            label: `Scan ${scan.Id}`,
            previewUrl,
            image,
            xTranslation: 0,
            yTranslation: 0,
            theta: 0,
            scale: 1,
            opacity: 0.75,
            visible: true
          });
        } catch {
          this.saveError = `Failed to load preview for scan ${scan.Id}.`;
        }
      }
    }

    for (const uploaded of selectedUploads) {
      try {
        const image = await this.createPreviewImageFromUploadedXyz(uploaded.file);

        this.overlays.push({
          scanId: uploaded.id,
          label: uploaded.name,
          previewUrl: '',
          image,
          xTranslation: 0,
          yTranslation: 0,
          theta: 0,
          scale: 1,
          opacity: 0.75,
          visible: true
        });
      } catch {
        this.saveError = `Failed to preview uploaded file ${uploaded.name}.`;
      }
    }

    if (this.overlays.length > 0) {
      this.overlays[0].opacity = 1;
      this.selectedOverlayIndex = 0;
    }

    this.mode = 'align';
    this.draw();
  }

  public selectOverlay(index: number): void {
    this.selectedOverlayIndex = index;

    this.overlays.forEach((o, i) => {
      o.opacity = i === index ? 1 : 0.75;
    });

    this.draw();
  }

  public rotateSelected(delta: number): void {
    if (!this.selectedOverlay) return;

    this.selectedOverlay.theta = Number((this.selectedOverlay.theta + delta).toFixed(4));
    this.draw();
  }

  public nudgeSelected(dx: number, dy: number): void {
    if (!this.selectedOverlay) return;

    this.selectedOverlay.xTranslation = Number((this.selectedOverlay.xTranslation + dx).toFixed(4));
    this.selectedOverlay.yTranslation = Number((this.selectedOverlay.yTranslation + dy).toFixed(4));
    this.draw();
  }

  public scaleSelected(delta: number): void {
  if (!this.selectedOverlay) return;

  this.selectedOverlay.scale = Math.max(
    0.05,
    Number((this.selectedOverlay.scale + delta).toFixed(3))
  );

  this.draw();
}

  public onWorkspaceKeyDown(event: KeyboardEvent): void {
  if (!this.selectedOverlay) return;

  const move = event.shiftKey ? 10 : 2;
  const rotate = event.shiftKey ? 10 : 2;
  const scale = event.shiftKey ? 0.1 : 0.025;

  switch (event.key) {
    case 'ArrowLeft':
      this.selectedOverlay.xTranslation -= move;
      break;

    case 'ArrowRight':
      this.selectedOverlay.xTranslation += move;
      break;

    case 'ArrowUp':
      this.selectedOverlay.yTranslation += move;
      break;

    case 'ArrowDown':
      this.selectedOverlay.yTranslation -= move;
      break;

    case '[':
      this.selectedOverlay.theta -= rotate;
      break;

    case ']':
      this.selectedOverlay.theta += rotate;
      break;

    case '+':
    case '=':
      this.selectedOverlay.scale += scale;
      break;

    case '-':
    case '_':
      this.selectedOverlay.scale = Math.max(0.05, this.selectedOverlay.scale - scale);
      break;

    case '0':
      this.selectedOverlay.xTranslation = 0;
      this.selectedOverlay.yTranslation = 0;
      this.selectedOverlay.theta = 0;
      this.selectedOverlay.scale = 1;
      break;

    default:
      return;
  }

  event.preventDefault();
  this.draw();
}

  public onCanvasMouseDown(event: MouseEvent): void {
    if (!this.workspaceCanvas) return;

    const point = this.eventToWorld(event);

    if (this.mode === 'calibrate') {
      if (this.calPoints.length < 2) {
        this.calPoints = [...this.calPoints, point];
        this.draw();
      }
      return;
    }

    if (this.mode !== 'align' && this.mode !== 'done' && this.mode !== 'select') return;
    if (!this.selectedOverlay) return;

    this.draggingOverlay = true;
    this.dragStartMouse = point;
    this.dragStartTranslation = {
      x: this.selectedOverlay.xTranslation,
      y: this.selectedOverlay.yTranslation
    };
  }

  public onCanvasMouseMove(event: MouseEvent): void {
    if (!this.draggingOverlay || !this.selectedOverlay || !this.dragStartMouse || !this.dragStartTranslation) {
      return;
    }

    const point = this.eventToWorld(event);
    const dx = point.x - this.dragStartMouse.x;
    const dy = point.y - this.dragStartMouse.y;

    this.selectedOverlay.xTranslation = Number((this.dragStartTranslation.x + dx).toFixed(4));
    this.selectedOverlay.yTranslation = Number((this.dragStartTranslation.y + dy).toFixed(4));

    this.draw();
  }

  public onCanvasMouseUp(): void {
    this.draggingOverlay = false;
    this.dragStartMouse = null;
    this.dragStartTranslation = null;
  }

  public async save(): Promise<void> {
    this.saveError = null;
    this.uploadMessage = null;

    if (!this.projectId || !this.deviceId) {
      this.saveError = 'Project/device context missing.';
      return;
    }

    if (this.overlays.length < 2) {
      this.saveError = 'Load at least two scan overlays first.';
      return;
    }

    const selectedUploads = this.uploadedFiles.filter(f =>
      this.selectedUploadedFileIds.includes(f.id)
    );

    if (selectedUploads.length > 0) {
      this.uploadMessage = 'Adding uploaded files into storage...';

      try {
        for (const uploaded of selectedUploads) {
          const result = await new Promise<any>((resolve, reject) => {
            this.scanCalibrationService.uploadXyz(this.projectId, this.deviceId!, uploaded.file).subscribe({
              next: resolve,
              error: reject
            });
          });

          const overlay = this.overlays.find(o => o.scanId === uploaded.id);
          if (overlay) {
            overlay.scanId = result.Id;
            overlay.label = result.OriginalFileName ?? overlay.label;
          }
        }
      } catch {
        this.uploadMessage = null;
        this.saveError = 'Failed to upload one or more XYZ files.';
        return;
      }

      this.uploadMessage = null;
    }

    const payload: CombineScansRequest = {
      output_name: this.outputName || 'calibrationScan',
      scalar_mm_per_pixel: this.scalarMmPerPixel,
      items: this.overlays.map((o, index) => ({
        scanId: o.scanId,
        x_translation: index === 0 ? 0 : o.xTranslation,
        y_translation: index === 0 ? 0 : o.yTranslation,
        Theta: index === 0 ? 0 : o.theta
      }))
    };

    localStorage.setItem(
      `lidar-scan-calibration-${this.projectId}`,
      JSON.stringify(payload)
    );

    this.saving = true;
    this.saveSuccess = false;

    this.scanCalibrationService.combine(this.projectId, this.deviceId, payload).subscribe({
      next: () => {
        this.saving = false;
        this.saveSuccess = true;
        this.mode = 'done';
      },
      error: () => {
        this.saving = false;
        this.saveError = 'Failed to combine scans.';
      }
    });
  }

  public load(): void {
    const raw = localStorage.getItem(`lidar-scan-calibration-${this.projectId}`);
    if (!raw) {
      this.saveError = 'No saved calibration found.';
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      this.selectedScanIds = parsed?.items?.map((x: any) => x.scanId) ?? [];
      this.outputName = parsed?.output_name ?? 'calibrationScan';
      this.scalarMmPerPixel = parsed?.scalar_mm_per_pixel ?? null;
      this.saveError = null;
    } catch {
      this.saveError = 'Could not load saved calibration.';
    }
  }

  public reset(): void {
    this.selectedScanIds = [];
    this.selectedUploadedFileIds = [];

    this.mode = 'select';
    this.calPoints = [];
    this.calDistanceMm = null;
    this.scalarMmPerPixel = null;

    this.overlays = [];
    this.selectedOverlayIndex = 0;

    this.saveError = null;
    this.saveSuccess = false;
    this.saving = false;
    this.uploadMessage = null;

    this.draggingOverlay = false;
    this.dragStartMouse = null;
    this.dragStartTranslation = null;

    this.outputName = 'calibrationScan';

    this.draw();
  }

  private resetOverlayStateOnly(): void {
    this.overlays = [];
    this.selectedOverlayIndex = 0;
    this.saveSuccess = false;
    this.draw();
  }

  private initCanvas(): void {
    const floorplanUrl = this.floorPlan?.ImageDownloadUrl ?? null;

    if (!floorplanUrl) {
      this.floorplanLoaded = false;
      this.draw();
      return;
    }

    this.floorplanImg = new Image();

    this.floorplanImg.onload = () => {
      this.floorplanLoaded = true;
      this.saveError = null;
      this.draw();
    };

    this.floorplanImg.onerror = () => {
      this.floorplanLoaded = false;
      this.saveError = 'Failed to load selected floorplan image.';
      this.draw();
    };

    this.floorplanImg.src = floorplanUrl;
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject();
      img.src = src;
    });
  }

  private async createPreviewImageFromUploadedXyz(file: File): Promise<HTMLImageElement> {
    const text = await file.text();
    const points: { x: number; y: number }[] = [];

    for (const line of text.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;

      const x = Number(parts[0]);
      const y = Number(parts[1]);
      const z = Number(parts[2]);

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

      points.push({ x, y });
    }

    if (points.length === 0) {
      throw new Error('No valid XYZ points found.');
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 500;
    canvas.height = 500;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not create preview canvas.');
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const padding = 30;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scale = Math.min(
      (canvas.width - padding * 2) / spanX,
      (canvas.height - padding * 2) / spanY
    );

    ctx.fillStyle = 'rgba(0, 120, 255, 0.75)';

    for (const p of points) {
      const px = padding + (p.x - minX) * scale;
      const py = canvas.height - (padding + (p.y - minY) * scale);
      ctx.fillRect(px, py, 1.5, 1.5);
    }

    const img = new Image();
    img.src = canvas.toDataURL('image/png');

    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject();
    });

    return img;
  }

  private resizeCanvasToDisplaySize(): void {
    const canvas = this.workspaceCanvas?.nativeElement;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();

    const width = Math.max(300, Math.floor(rect.width));
    const height = Math.max(300, Math.floor(rect.height));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  public draw(): void {
    const canvas = this.workspaceCanvas?.nativeElement;
    if (!canvas) return;

    this.resizeCanvasToDisplaySize();

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, w, h);

    if (this.floorplanLoaded && this.floorplanImg) {
      const img = this.floorplanImg;

      const scale = Math.min(w / img.naturalWidth, h / img.naturalHeight);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      const drawX = (w - drawW) / 2;
      const drawY = (h - drawH) / 2;

      ctx.drawImage(img, drawX, drawY, drawW, drawH);
    }

    ctx.save();
    ctx.strokeStyle = 'rgba(100,116,139,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
    ctx.restore();

    this.overlays.forEach((overlay, index) => {
      if (!overlay.visible || !overlay.image) return;

      ctx.save();
      ctx.translate(cx + overlay.xTranslation, cy - overlay.yTranslation);
      ctx.rotate((-overlay.theta * Math.PI) / 180);
      ctx.globalAlpha = overlay.opacity;

      const img = overlay.image;
      const drawW = img.width * overlay.scale;
      const drawH = img.height * overlay.scale;

      ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);

      if (index === this.selectedOverlayIndex) {
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2;
        ctx.strokeRect(-drawW / 2, -drawH / 2, drawW, drawH);
      }

      ctx.restore();
    });

    if (this.mode === 'calibrate') {
      for (const pt of this.calPoints) {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'red';
        ctx.fill();
      }

      if (this.calPoints.length === 2) {
        const p1 = this.calPoints[0];
        const p2 = this.calPoints[1];

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  private eventToWorld(event: MouseEvent): ClickPoint {
    const canvas = this.workspaceCanvas!.nativeElement;
    const rect = canvas.getBoundingClientRect();

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const xCanvas = (event.clientX - rect.left) * scaleX;
    const yCanvas = (event.clientY - rect.top) * scaleY;

    if (this.mode === 'calibrate') {
      return {
        x: xCanvas,
        y: yCanvas
      };
    }

    return {
      x: xCanvas - canvas.width / 2,
      y: canvas.height / 2 - yCanvas
    };
  }
}
