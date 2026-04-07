import { Component, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';

interface LayerState {
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

  // Drag state
  dragging = false;
  lastXY: [number, number] = [0, 0];

  // Display
  maxDisplayDim = 1200;

  // Track point overlay
  showTrackPoints = false;
  trackPoints: { mac: string; x: number; y: number }[] = [];

  ngAfterViewInit() {
    this.loadData();
  }

  async loadData() {
    // Load test data from public folder
    const resp = await fetch('test-puzzle/puzzle-data.json');
    const data = await resp.json();

    // Load floorplan
    this.floorplanImg.src = 'test-puzzle/floorplan.png';
    await new Promise(resolve => this.floorplanImg.onload = resolve);
    this.fpW = this.floorplanImg.naturalWidth;
    this.fpH = this.floorplanImg.naturalHeight;
    this.dscale = Math.min(1, this.maxDisplayDim / Math.max(this.fpW, this.fpH));
    this.originFp = [0, this.fpH - 1]; // default: bottom-left

    // Size the canvas
    const canvas = this.canvasRef.nativeElement;
    canvas.width = Math.round(this.fpW * this.dscale);
    canvas.height = Math.round(this.fpH * this.dscale);

    // Load each camera BEV image
    for (const cam of data.cameras) {
      const img = new Image();
      img.src = cam.bevImage;
      const layer: LayerState = {
        macTag: cam.macTag.toLowerCase().replace(/:/g, '_'),
        bevImage: img,
        hLocalCanvas: cam.hLocalCanvas,
        centerFp: [this.fpW / 2, this.fpH / 2],
        angleDeg: 0,
        scale: 1,
        loaded: false,
      };

      const rawH = cam.hLocalCanvas;
      img.onload = () => {
        // Convert black background to transparent
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = img.naturalWidth;
        tempCanvas.height = img.naturalHeight;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.drawImage(img, 0, 0);
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        const d = imageData.data;
        for (let px = 0; px < d.length; px += 4) {
          if (d[px] < 10 && d[px + 1] < 10 && d[px + 2] < 10) {
            d[px + 3] = 0;
          }
        }
        tempCtx.putImageData(imageData, 0, 0);
        const cleanImg = new Image();
        cleanImg.onload = () => {
          layer.bevImage = cleanImg;
          layer.loaded = true;
          // Compute fitted homography using actual image dimensions
          if (rawH) {
            layer.hLocalCanvas = this.fitHomographyToCanvas(
              rawH, 3072, 1728, cleanImg.naturalWidth, cleanImg.naturalHeight
            );
          }
          this.draw();
        };
        cleanImg.src = tempCanvas.toDataURL('image/png');
      };

      this.layers.push(layer);
    }

    // Load test track points if available
    try {
      const trackResp = await fetch('test-puzzle/test-points.jsonl');
      if (trackResp.ok) {
        const text = await trackResp.text();
        this.trackPoints = text.trim().split('\n')
          .map(line => { try { return JSON.parse(line); } catch { return null; } })
          .filter(obj => obj && obj.type === 'track')
          .map(obj => ({
            mac: obj.mac.toLowerCase().replace(/:/g, '_'),
            x: obj.x,
            y: obj.y,
          }));
        console.log(`Loaded ${this.trackPoints.length} test points`);
      }
    } catch (e) {
      // No test points file, that's fine
    }

    this.draw();
    // Focus the container so keyboard events work
    this.canvasRef.nativeElement.parentElement?.focus();
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
      ctx.scale(layer.scale, layer.scale);
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
    const placements = this.layers.map(l => ({
      macTag: l.macTag,
      centerFp: l.centerFp,
      angleDeg: l.angleDeg,
      scale: l.scale,
      hLocalCanvas: l.hLocalCanvas,
      localCanvasSize: [l.bevImage.naturalWidth, l.bevImage.naturalHeight],
    }));

    const output = {
      mmPerFpPx: this.mmPerFpPx,
      originFp: this.originFp,
      floorplanSize: [this.fpW, this.fpH],
      placements: placements,
    };

    // Need to add POST to server.
    console.log('Puzzle state:', JSON.stringify(output, null, 2));
    alert('Saved! Check console for output.');
  }
}