import { Component, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { ActivatedRoute } from '@angular/router';
import { HomographyService, PuzzlePieceDto } from '../../../../../services/homography-service';


interface LayerState {
  puzzlePieceId: string;
  deviceId: string;
  cameraMac: string;
  macTag: string;
  bevImage: HTMLImageElement;
  hLocalCanvas: number[][];
  centerFp: [number, number];
  angleDeg: number;
  scale: number;
  loaded: boolean;
}


@Component({
  selector: 'app-puzzle',
  standalone: true,
  imports: [CommonModule, FormsModule, InputTextModule, ButtonModule],
  templateUrl: './puzzle.component.html',
  styleUrl: './puzzle.component.scss',
})
export class PuzzleComponent implements AfterViewInit {
  @ViewChild('puzzleCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  layers: LayerState[] = [];
  selectedIndex = 0;
  revealedCount = 1;
  opacity = 0.75;

  // Calibration state
  mode: 'calibrate' | 'puzzle' = 'calibrate';
  calPoints: [number, number][] = [];
  calDistanceMm = 0;
  mmPerFpPx = 1;
  originFp: [number, number] = [0, 0];

  // Floorplan
  floorplanImg = new Image();
  fpW = 0;
  fpH = 0;
  dscale = 1;
  floorplanId: string | null = null;
  projectId = '';

  // Drag state
  dragging = false;
  lastXY: [number, number] = [0, 0];

  // Display
  maxDisplayDim = 1200;

  // Track point overlay
  showTrackPoints = false;
  trackPoints: { mac: string; x: number; y: number }[] = [];

  loading = false;
  saving = false;
  saveError: string | null = null;
  error: string | null = null;

  // ── Dev flag: set to true to use local test images instead of the API ──
  private readonly HARDCODE_PIECES = true;

  private static readonly HARDCODED_CAMERAS = [
    { mac: 'd0:3b:f4:01:52:9a', deviceId: 'dev-hardcoded', img: 'test-puzzle/d0_3b_f4_01_52_9a.jpg', hLocalCanvas: [[478.67059918109902, 93.72391283749289, -776099.94435480505], [-59.532010441440306, 746.25038739208344, -706116.16342598724], [-0.0075507867073095992, 0.11294200201598935, 1.0]] },
    { mac: 'd0:3b:f4:01:52:79', deviceId: 'dev-hardcoded', img: 'test-puzzle/d0_3b_f4_01_52_79.jpg', hLocalCanvas: [[10.187341554896124, -13.216440197794686, 2664.9565203487869], [12.517588140314425, 14.585128792798074, -31875.339206640292], [6.8474148621029351e-05, 0.003165424636317036, 1.0]] },
    { mac: 'd0:3b:f4:01:52:91', deviceId: 'dev-hardcoded', img: 'test-puzzle/d0_3b_f4_01_52_91.jpg', hLocalCanvas: [[24.692741382496273, 3.5021653163134205, -37471.798385837486], [-1.8112859685224374, 32.902511044434327, -34372.366038374887], [-0.00023027490343334098, 0.0052858896913279586, 1.0]] },
    { mac: 'd0:3b:f4:01:52:f1', deviceId: 'dev-hardcoded', img: 'test-puzzle/d0_3b_f4_01_52_f1.jpg', hLocalCanvas: [[12.393868945811136, 0.42293506877994574, -17499.133727320324], [0.55567686063031441, 15.810112182648471, -17013.782111363336], [4.5377735995530908e-05, 0.0023112295496079045, 0.99999999999999989]] },
    { mac: 'd0:3b:f4:02:44:84', deviceId: 'dev-hardcoded', img: 'test-puzzle/d0_3b_f4_02_44_84.jpg', hLocalCanvas: [[1.5407599010689346, -3.428882774540277, 13147.852373035557], [6.2519886718965942, 16.41486546041817, -2601.1331305760923], [-5.6373942607233279e-05, 0.0014192032848097187, 1.0]] },
    { mac: 'd0:3b:f4:02:44:85', deviceId: 'dev-hardcoded', img: 'test-puzzle/d0_3b_f4_02_44_85.jpg', hLocalCanvas: [[14.948226477594419, 3.0578753984632412, -24070.046259558043], [-2.9735241456379788, 22.447668981301263, -17634.867530003179], [-0.00045912539444331054, 0.0032539794052085539, 1.0]] },
    { mac: 'd0:3b:f4:02:44:87', deviceId: 'dev-hardcoded', img: 'test-puzzle/d0_3b_f4_02_44_87.jpg', hLocalCanvas: [[40.894152918165425, 5.7345388584038401, -59455.115363930512], [-1.9619594523715058, 58.261762850609912, -60323.951670044917], [-0.00078790506478346298, 0.009410378593881585, 0.99999999999999989]] },
    { mac: 'd0:3b:f4:02:44:e2', deviceId: 'dev-hardcoded', img: 'test-puzzle/d0_3b_f4_02_44_e2.jpg', hLocalCanvas: [[59.721969268461272, 8.9656492262286083, -87034.400273248204], [-4.7349897237544001, 94.959396720834491, -90943.707866467172], [-0.001763042991715867, 0.014486015099557889, 1.0]] },
  ];

  constructor(
    private readonly route: ActivatedRoute,
    private readonly homographyService: HomographyService,
  ) {}


  ngAfterViewInit() {
    this.projectId = this.route.snapshot.paramMap.get('projectId') ?? '';
    this.floorplanId = this.route.snapshot.queryParamMap.get('floorplanId') ?? null;
    this.loadWorkspace(this.projectId);
  }

  private loadWorkspace(projectId: string): void {
    this.loading = true;
    this.initCanvas();

    if (this.HARDCODE_PIECES) {
      this.loading = false;
      this.loadHardcodedPieces();
      return;
    }

    this.homographyService.getPuzzleWorkspace(projectId).subscribe({
      next: (workspace) => {
        this.loading = false;
        const ready = workspace.PuzzlePieces.filter(
          (p) => p.Status === 'ready' && p.PuzzlePieceDownloadUrl && p.Metadata
        );
        if (ready.length === 0) {
          this.error = 'No puzzle pieces ready. Ensure ChArUco homography scans have completed.';
          return;
        }
        ready.forEach((piece) => this.loadPiece(piece));
      },
      error: () => { this.loading = false; },
    });
  }

  private loadHardcodedPieces(): void {
    PuzzleComponent.HARDCODED_CAMERAS.forEach((cam) => {
      const img = new Image();
      const layer: LayerState = {
        puzzlePieceId: `hardcoded-${cam.mac}`,
        deviceId: cam.deviceId,
        cameraMac: cam.mac,
        macTag: cam.mac.replace(/:/g, '_'),
        bevImage: img,
        hLocalCanvas: cam.hLocalCanvas,
        centerFp: [this.fpW / 2, this.fpH / 2],
        angleDeg: 0,
        scale: 1,
        loaded: false,
      };
      img.onload = () => {
        const cropped = this.trimWhiteBorder(img);
        layer.bevImage = cropped;
        if (this.fpW > 0 && cropped.naturalWidth > 0) {
          layer.scale = (this.fpW * 0.5) / cropped.naturalWidth;
        }
        layer.loaded = true;
        this.draw();
      };
      img.src = cam.img;
      this.layers.push(layer);
    });
  }

  /** Crops white/near-white border pixels from an image and returns a new HTMLImageElement. */
  private trimWhiteBorder(src: HTMLImageElement, threshold = 240): HTMLImageElement {
    const offscreen = document.createElement('canvas');
    offscreen.width = src.naturalWidth;
    offscreen.height = src.naturalHeight;
    const ctx = offscreen.getContext('2d')!;
    ctx.drawImage(src, 0, 0);

    const { data, width, height } = ctx.getImageData(0, 0, offscreen.width, offscreen.height);
    let top = height, bottom = 0, left = width, right = 0;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
        if (a > 10 && !(r >= threshold && g >= threshold && b >= threshold)) {
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }

    // If nothing found (fully white image), return original
    if (top > bottom || left > right) return src;

    const cropW = right - left + 1;
    const cropH = bottom - top + 1;
    const cropped = document.createElement('canvas');
    cropped.width = cropW;
    cropped.height = cropH;
    cropped.getContext('2d')!.drawImage(offscreen, left, top, cropW, cropH, 0, 0, cropW, cropH);

    const result = new Image();
    result.src = cropped.toDataURL('image/png');
    return result;
  }

  private initCanvas(): void {
    const floorplanUrl = this.route.snapshot.queryParamMap.get('floorplanUrl')
      ?? 'test-puzzle/floorplan.png';
    this.floorplanImg.src = floorplanUrl;
    this.floorplanImg.onload = () => {
      this.fpW = this.floorplanImg.naturalWidth;
      this.fpH = this.floorplanImg.naturalHeight;
      this.dscale = Math.min(1, this.maxDisplayDim / Math.max(this.fpW, this.fpH));
      this.originFp = [0, this.fpH - 1];
      const canvas = this.canvasRef.nativeElement;
      canvas.width = Math.round(this.fpW * this.dscale);
      canvas.height = Math.round(this.fpH * this.dscale);
      // Centre any already-loaded hardcoded layers now that floorplan dimensions are known
      for (const layer of this.layers) {
        if (layer.centerFp[0] === 0 && layer.centerFp[1] === 0) {
          layer.centerFp = [this.fpW / 2, this.fpH / 2];
        }
      }
      this.draw();
    };
  }

  private loadPiece(piece: PuzzlePieceDto): void {
    const img = new Image();
    const layer: LayerState = {
      puzzlePieceId: piece.PuzzlePieceId,
      deviceId: piece.DeviceId,
      cameraMac: piece.CameraMac,
      macTag: piece.CameraMac.replace(/:/g, '_'),
      bevImage: img,
      hLocalCanvas: piece.Metadata!.HLocalCanvas,
      centerFp: [this.fpW / 2, this.fpH / 2],
      angleDeg: 0,
      scale: 1,
      loaded: false,
    };
    img.onload = () => {
      if (this.fpW > 0 && img.naturalWidth > 0) {
        layer.scale = (this.fpW * 0.2) / img.naturalWidth;
      }
      layer.loaded = true;
      this.draw();
    };
    img.src = piece.PuzzlePieceDownloadUrl!;
    this.layers.push(layer);
  }


  draw() {
    const canvas = this.canvasRef.nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear and draw floorplan
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.floorplanImg, 0, 0, canvas.width, canvas.height);

    // Draw calibration points if in calibration mode
    if (this.mode === 'calibrate') {
      for (const pt of this.calPoints) {
        ctx.beginPath();
        ctx.arc(pt[0] * this.dscale, pt[1] * this.dscale, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'red';
        ctx.fill();
      }
      if (this.calPoints.length === 2) {
        ctx.beginPath();
        ctx.moveTo(this.calPoints[0][0] * this.dscale, this.calPoints[0][1] * this.dscale);
        ctx.lineTo(this.calPoints[1][0] * this.dscale, this.calPoints[1][1] * this.dscale);
        ctx.strokeStyle = 'red';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      return;
    }

    // Draw revealed layers
    for (let i = 0; i < this.revealedCount && i < this.layers.length; i++) {
      const layer = this.layers[i];
      if (!layer.loaded) continue;

      const cx = layer.centerFp[0] * this.dscale;
      const cy = layer.centerFp[1] * this.dscale;
      const angle = layer.angleDeg * Math.PI / 180;
      const imgW = layer.bevImage.naturalWidth;
      const imgH = layer.bevImage.naturalHeight;

      ctx.save();
      ctx.globalAlpha = this.opacity;
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.scale(layer.scale * this.dscale, layer.scale * this.dscale);
      ctx.drawImage(layer.bevImage, -imgW / 2, -imgH / 2);
      ctx.restore();
    }

    // Draw track points on puzzle if enabled
    if (this.showTrackPoints && this.trackPoints.length > 0) {
      ctx.globalAlpha = 1;
      const camColors: Record<string, string> = {};
      const colorList = ['#ff0000', '#00cc00', '#0000ff', '#cccc00', '#cc00cc', '#00cccc', '#ff8800', '#8800ff', '#88ff00', '#ff8888'];
      let colorIdx = 0;
      // Assign colors to cameras
      for (const layer of this.layers) {
        if (!camColors[layer.macTag]) {
          camColors[layer.macTag] = colorList[colorIdx % colorList.length];
          colorIdx++;
        }
      }
      // Transform and draw each point
      for (const pt of this.trackPoints) {
        const layer = this.layers.find(l => l.macTag === pt.mac);
        if (!layer) continue;
        // Build H_to_fp = A_fp @ h_local_canvas
        const lw = layer.bevImage.naturalWidth;
        const lh = layer.bevImage.naturalHeight;
        const pivotX = lw / 2;
        const pivotY = lh / 2;
        const a = layer.angleDeg * Math.PI / 180;
        const cos = Math.cos(a) * layer.scale;
        const sin = Math.sin(a) * layer.scale;
        const cx = layer.centerFp[0];
        const cy = layer.centerFp[1];
        // pose_matrix values
        const A = [
          [cos, -sin, cx - cos * pivotX + sin * pivotY],
          [sin,  cos, cy - sin * pivotX - cos * pivotY],
          [0, 0, 1]
        ];
        // Multiply A @ h_local_canvas
        const H = layer.hLocalCanvas;
        const M = [
          [A[0][0]*H[0][0] + A[0][1]*H[1][0] + A[0][2]*H[2][0],
           A[0][0]*H[0][1] + A[0][1]*H[1][1] + A[0][2]*H[2][1],
           A[0][0]*H[0][2] + A[0][1]*H[1][2] + A[0][2]*H[2][2]],
          [A[1][0]*H[0][0] + A[1][1]*H[1][0] + A[1][2]*H[2][0],
           A[1][0]*H[0][1] + A[1][1]*H[1][1] + A[1][2]*H[2][1],
           A[1][0]*H[0][2] + A[1][1]*H[1][2] + A[1][2]*H[2][2]],
          [A[2][0]*H[0][0] + A[2][1]*H[1][0] + A[2][2]*H[2][0],
           A[2][0]*H[0][1] + A[2][1]*H[1][1] + A[2][2]*H[2][1],
           A[2][0]*H[0][2] + A[2][1]*H[1][2] + A[2][2]*H[2][2]],
        ];
        // perspectiveTransform: [x', y', w'] = M @ [px, py, 1]
        const wx = M[0][0] * pt.x + M[0][1] * pt.y + M[0][2];
        const wy = M[1][0] * pt.x + M[1][1] * pt.y + M[1][2];
        const w  = M[2][0] * pt.x + M[2][1] * pt.y + M[2][2];
        if (Math.abs(w) < 1e-10) continue;
        const fpX = wx / w;
        const fpY = wy / w;
        // Convert to display coords
        const dispX = fpX * this.dscale;
        const dispY = fpY * this.dscale;
        if (this.trackPoints.indexOf(pt) < 5) {
          console.log(`Point ${pt.mac} (${pt.x}, ${pt.y}) -> fp(${fpX.toFixed(1)}, ${fpY.toFixed(1)}) -> disp(${dispX.toFixed(1)}, ${dispY.toFixed(1)}) canvas(${canvas.width}, ${canvas.height})`);
        }
        if (dispX >= 0 && dispX < canvas.width && dispY >= 0 && dispY < canvas.height) {
          ctx.beginPath();
          ctx.arc(dispX, dispY, 3, 0, Math.PI * 2);
          ctx.fillStyle = camColors[pt.mac] || '#ffffff';
          ctx.fill();
        }
      }
    }

    // Status text
    ctx.globalAlpha = 1;

    const layer = this.layers[this.selectedIndex];
    if (layer) {
      const trackTag = this.showTrackPoints ? '  [TRACKS]' : '';
      const text = `${this.selectedIndex + 1}/${this.layers.length} ${layer.macTag} rot=${layer.angleDeg.toFixed(1)} scale=${layer.scale.toFixed(3)}${trackTag}`;
      ctx.font = '16px monospace';
      ctx.fillStyle = 'black';
      ctx.fillText(text, 11, 26);
      ctx.fillStyle = 'white';
      ctx.fillText(text, 10, 25);
    }
  }

  fitHomographyToCanvas(H: number[][], srcW: number, srcH: number, outW: number, outH: number): number[][] {
    // Warp the four corners through H to find the bounding box
    const corners = [[0, 0], [srcW - 1, 0], [srcW - 1, srcH - 1], [0, srcH - 1]];
    const warped = corners.map(([x, y]) => {
      const wx = H[0][0] * x + H[0][1] * y + H[0][2];
      const wy = H[1][0] * x + H[1][1] * y + H[1][2];
      const w  = H[2][0] * x + H[2][1] * y + H[2][2];
      return [wx / w, wy / w];
    });

    const xs = warped.map(p => p[0]);
    const ys = warped.map(p => p[1]);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);

    const bw = maxX - minX;
    const bh = maxY - minY;
    if (bw < 1e-6 || bh < 1e-6) return H;

    const s = Math.min(outW / bw, outH / bh);
    const padX = (outW - bw * s) / 2;
    const padY = (outH - bh * s) / 2;

    // Build: center @ scale @ translate @ H
    // translate: [1, 0, -minX; 0, 1, -minY; 0, 0, 1]
    // scale:     [s, 0, 0;     0, s, 0;      0, 0, 1]
    // center:    [1, 0, padX;  0, 1, padY;   0, 0, 1]
    // Combined pre-multiply: [s, 0, padX - s*minX; 0, s, padY - s*minY; 0, 0, 1]
    const P = [
      [s, 0, padX - s * minX],
      [0, s, padY - s * minY],
      [0, 0, 1],
    ];

    // Multiply P @ H
    return this.matMul3x3(P, H);
  }

  matMul3x3(A: number[][], B: number[][]): number[][] {
    const R: number[][] = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        R[i][j] = A[i][0]*B[0][j] + A[i][1]*B[1][j] + A[i][2]*B[2][j];
      }
    }
    return R;
  }

  // ---- Mouse handling ----

  onMouseDown(e: MouseEvent) {
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (this.mode === 'calibrate') {
      if (this.calPoints.length < 2) {
        // Store in floorplan pixel coords (not display coords)
        this.calPoints.push([x / this.dscale, y / this.dscale]);
        this.draw();
      }
      return;
    }

    this.dragging = true;
    this.lastXY = [x, y];
  }

  onMouseMove(e: MouseEvent) {
    if (!this.dragging || this.mode !== 'puzzle') return;
    const canvas = this.canvasRef.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const dx = (x - this.lastXY[0]) / this.dscale;
    const dy = (y - this.lastXY[1]) / this.dscale;
    this.lastXY = [x, y];

    const layer = this.layers[this.selectedIndex];
    if (layer) {
      layer.centerFp = [layer.centerFp[0] + dx, layer.centerFp[1] + dy];
      this.draw();
    }
  }

  onMouseUp(e: MouseEvent) {
    this.dragging = false;
  }

  // ---- Keyboard handling ----

  onKeyDown(e: KeyboardEvent) {
    if (this.mode !== 'puzzle') return;
    const layer = this.layers[this.selectedIndex];
    if (!layer) return;

    const rotateStep = 1;
    const scaleStep = 1.02;
    const nudgePx = 10;

    switch (e.key) {
      case 'Tab':
        e.preventDefault();
        this.selectedIndex = (this.selectedIndex + 1) % this.layers.length;
        this.revealedCount = Math.max(this.revealedCount, this.selectedIndex + 1);
        break;
      case 'b':
      case 'B':
        this.selectedIndex = (this.selectedIndex - 1 + this.layers.length) % this.layers.length;
        break;
      case '[':
        layer.angleDeg -= rotateStep;
        break;
      case ']':
        layer.angleDeg += rotateStep;
        break;
      case '-':
        layer.scale /= scaleStep;
        break;
      case '=':
        layer.scale *= scaleStep;
        break;
      case 'ArrowUp':
        e.preventDefault();
        layer.centerFp = [layer.centerFp[0], layer.centerFp[1] - nudgePx];
        break;
      case 'ArrowDown':
        e.preventDefault();
        layer.centerFp = [layer.centerFp[0], layer.centerFp[1] + nudgePx];
        break;
      case 'ArrowLeft':
        e.preventDefault();
        layer.centerFp = [layer.centerFp[0] - nudgePx, layer.centerFp[1]];
        break;
      case 'ArrowRight':
        e.preventDefault();
        layer.centerFp = [layer.centerFp[0] + nudgePx, layer.centerFp[1]];
        break;
      case 't':
      case 'T':
        this.showTrackPoints = !this.showTrackPoints;
        console.log(`Track points ${this.showTrackPoints ? 'ON' : 'OFF'} (${this.trackPoints.length} points)`);
        console.log('Layer MACs:', this.layers.map(l => l.macTag));
        console.log('Point MACs:', [...new Set(this.trackPoints.map(p => p.mac))]);
        break;
    }
    this.draw();
  }

  // ---- Calibration ----

  finishCalibration() {
    if (this.calPoints.length !== 2 || this.calDistanceMm <= 0) return;
    const dx = this.calPoints[1][0] - this.calPoints[0][0];
    const dy = this.calPoints[1][1] - this.calPoints[0][1];
    const distPx = Math.sqrt(dx * dx + dy * dy);
    if (distPx < 1) return;
    this.mmPerFpPx = this.calDistanceMm / distPx;
    this.mode = 'puzzle';
    console.log('mm_per_fp_px =', this.mmPerFpPx);
    this.draw();
  }

  // ---- Save ----

  save() {
    if (this.saving) return;
    this.saveError = null;

    const placements = this.layers.map(l => ({
      PuzzlePieceId: l.puzzlePieceId,
      DeviceId: l.deviceId,
      CameraMac: l.cameraMac,
      CenterFp: [l.centerFp[0], l.centerFp[1]],
      AngleDeg: l.angleDeg,
      Scale: l.scale,
      HLocalCanvas: l.hLocalCanvas,
      LocalCanvasSize: [l.bevImage.naturalWidth, l.bevImage.naturalHeight],
    }));

    const payload = {
      FloorplanId: this.floorplanId ?? null,
      MmPerFpPx: this.mmPerFpPx,
      OriginFp: [this.originFp[0], this.originFp[1]],
      FloorplanSize: [this.fpW, this.fpH],
      Placements: placements,
    };

    this.saving = true;
    this.homographyService.saveGlobalHomographies(this.projectId, payload).subscribe({
      next: () => { this.saving = false; },
      error: () => {
        this.saving = false;
        this.saveError = 'Failed to save. Try again.';
      },
    });
  }
}