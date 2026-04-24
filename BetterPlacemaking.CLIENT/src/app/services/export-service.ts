import { Injectable } from '@angular/core';
import { forkJoin, of, firstValueFrom } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { jsPDF } from 'jspdf';

import { ProjectService } from './project-service';
import { DeviceService } from './device-service';
import { ScanService, ProjectScanRecord } from './scan-service';
import { VisualizerService, LidarPoint3D } from './visualizer-service';
import { ProjectDto } from '../models/ProjectDto';
import { DeviceDto } from '../models/DeviceDto';
import { ScanScheduleDto } from './scan-service';

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const HEARTBEAT_GRACE_MULTIPLIER = 6;
const MIN_ONLINE_WINDOW_MS = 2 * 60 * 1000;

const SCAN_PALETTE: Array<[number, number, number]> = [
  [231, 76, 60], [52, 152, 219], [46, 204, 113], [241, 196, 15],
  [155, 89, 182], [26, 188, 156], [230, 126, 34], [52, 73, 94],
];

export interface ExportSections {
  overview: boolean;
  devices: boolean;
  schedules: boolean;
  currentPointCloud: boolean;
  scanCaptures: boolean;
}

export interface ExportConfig {
  projectId: string;
  title?: string;
  notes?: string;
  sections: ExportSections;
  dateRange?: { from?: Date; to?: Date };
  selectedScans: ProjectScanRecord[];
  /** Gated: renders one composite overlay after per-scan thumbnails. Requires flattened/aligned .xyz. */
  includeOverlapComposite: boolean;
}

export type ExportProgressCallback = (done: number, total: number, label?: string) => void;

@Injectable({ providedIn: 'root' })
export class ExportService {
  constructor(
    private projectService: ProjectService,
    private deviceService: DeviceService,
    private scanService: ScanService,
    private visualizerService: VisualizerService
  ) {}

  /**
   * New entry point used by the configure-export modal. Fetches project/devices/schedules/current
   * points in parallel, then renders only the sections enabled in `config.sections`.
   */
  async exportProjectPdfWithConfig(
    config: ExportConfig,
    progress?: ExportProgressCallback,
  ): Promise<void> {
    const bundle = await firstValueFrom(forkJoin({
      project: this.projectService.getProject(config.projectId),
      devices: this.deviceService.getDevices(),
      schedules: this.scanService.getSchedules(config.projectId),
      points: this.visualizerService.getPoints().pipe(catchError(() => of([] as LidarPoint3D[]))),
    }));
    const projectDevices = bundle.devices.filter(d => d.ProjectId === config.projectId);
    await this.generatePdf(bundle.project, projectDevices, bundle.schedules, bundle.points, config, progress);
  }

  private async generatePdf(
    project: ProjectDto,
    devices: DeviceDto[],
    schedules: ScanScheduleDto[],
    currentPoints: LidarPoint3D[],
    config: ExportConfig,
    progress?: ExportProgressCallback,
  ): Promise<void> {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    const ctx = { y: 20, margin, pageWidth, contentWidth };

    const checkPage = (needed: number) => {
      if (ctx.y + needed > doc.internal.pageSize.getHeight() - 20) {
        doc.addPage();
        ctx.y = 20;
      }
    };

    this.renderHeader(doc, ctx, config, checkPage);

    if (config.sections.overview) this.renderProjectOverview(doc, ctx, project, checkPage);
    if (config.sections.devices) this.renderDevicesSection(doc, ctx, devices, checkPage);
    if (config.sections.schedules) this.renderSchedulesSection(doc, ctx, schedules, checkPage);
    if (config.sections.currentPointCloud) this.renderCurrentPointCloud(doc, ctx, currentPoints, checkPage);
    if (config.sections.scanCaptures && config.selectedScans.length > 0) {
      await this.renderScanCaptures(doc, ctx, config, checkPage, progress);
    }

    // Footer on every page
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Better Placemaking — ${config.title || project.Title || 'Project'} — Page ${i} of ${totalPages}`,
        pageWidth / 2, doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    const safeName = (config.title || project.Title || 'project').replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(`${safeName}_report.pdf`);
  }

  // --- Section renderers ---

  private renderHeader(
    doc: jsPDF,
    ctx: { y: number; margin: number; pageWidth: number; contentWidth: number },
    config: ExportConfig,
    checkPage: (n: number) => void,
  ): void {
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text(config.title || 'Better Placemaking', ctx.margin, ctx.y);
    ctx.y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`Exported ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, ctx.margin, ctx.y);
    doc.setTextColor(0, 0, 0);
    ctx.y += 6;

    if (config.notes && config.notes.trim()) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      const lines = doc.splitTextToSize(config.notes.trim(), ctx.contentWidth);
      for (const ln of lines) {
        checkPage(6);
        doc.text(ln, ctx.margin, ctx.y);
        ctx.y += 5;
      }
      doc.setFont('helvetica', 'normal');
      ctx.y += 2;
    }

    doc.setDrawColor(200, 200, 200);
    doc.line(ctx.margin, ctx.y, ctx.pageWidth - ctx.margin, ctx.y);
    ctx.y += 12;
  }

  private renderProjectOverview(
    doc: jsPDF,
    ctx: { y: number; margin: number; pageWidth: number; contentWidth: number },
    project: ProjectDto,
    checkPage: (n: number) => void,
  ): void {
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Project Overview', ctx.margin, ctx.y);
    ctx.y += 10;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');

    const rows = [
      ['Title', project.Title || '-'],
      ['Description', project.Description || '-'],
      ['Location', project.Location || '-'],
    ];
    for (const [label, value] of rows) {
      checkPage(8);
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, ctx.margin, ctx.y);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(value, ctx.contentWidth - 40);
      doc.text(lines, ctx.margin + 40, ctx.y);
      ctx.y += lines.length * 6 + 2;
    }
    ctx.y += 8;
  }

  private renderDevicesSection(
    doc: jsPDF,
    ctx: { y: number; margin: number; pageWidth: number; contentWidth: number },
    devices: DeviceDto[],
    checkPage: (n: number) => void,
  ): void {
    checkPage(30);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Devices', ctx.margin, ctx.y);
    ctx.y += 4;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`${devices.length} device(s) assigned`, ctx.margin, ctx.y);
    doc.setTextColor(0, 0, 0);
    ctx.y += 8;

    if (devices.length === 0) {
      doc.setFontSize(11);
      doc.text('No devices currently assigned to this project.', ctx.margin, ctx.y);
      ctx.y += 10;
      return;
    }

    checkPage(12);
    doc.setFillColor(240, 240, 240);
    doc.rect(ctx.margin, ctx.y - 4, ctx.contentWidth, 8, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Device Name', ctx.margin + 2, ctx.y);
    doc.text('Status', ctx.margin + 60, ctx.y);
    doc.text('Last Seen', ctx.margin + 95, ctx.y);
    doc.text('Resolution', ctx.margin + 140, ctx.y);
    ctx.y += 8;

    doc.setFont('helvetica', 'normal');
    for (const device of devices) {
      checkPage(10);
      const status = this.getDeviceStatus(device);
      const lastSeen = this.formatTimestamp(device.HealthReport?.Timestamp);
      const resolution = device.Config?.Camera?.Resolution || '-';

      doc.text(device.Name || device.Id || '-', ctx.margin + 2, ctx.y);
      doc.setTextColor(...this.statusColor(status));
      doc.text(status, ctx.margin + 60, ctx.y);
      doc.setTextColor(0, 0, 0);
      doc.text(lastSeen, ctx.margin + 95, ctx.y);
      doc.text(resolution, ctx.margin + 140, ctx.y);

      ctx.y += 7;
      doc.setDrawColor(230, 230, 230);
      doc.line(ctx.margin, ctx.y - 2, ctx.pageWidth - ctx.margin, ctx.y - 2);
    }

    for (const device of devices) {
      if (!device.HealthReport?.Services) continue;
      checkPage(20);
      ctx.y += 6;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(`${device.Name || device.Id} — Services`, ctx.margin, ctx.y);
      ctx.y += 6;

      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      for (const [name, svc] of Object.entries(device.HealthReport.Services)) {
        checkPage(7);
        const active = (svc as any)?.Active || 'unknown';
        doc.text(`${name}: ${active}`, ctx.margin + 4, ctx.y);
        ctx.y += 5;
      }
    }
    ctx.y += 10;
  }

  private renderSchedulesSection(
    doc: jsPDF,
    ctx: { y: number; margin: number; pageWidth: number; contentWidth: number },
    schedules: ScanScheduleDto[],
    checkPage: (n: number) => void,
  ): void {
    checkPage(30);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Scan Schedules', ctx.margin, ctx.y);
    ctx.y += 4;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`${schedules.length} schedule(s)`, ctx.margin, ctx.y);
    doc.setTextColor(0, 0, 0);
    ctx.y += 8;

    if (schedules.length === 0) {
      doc.setFontSize(11);
      doc.text('No scan schedules configured.', ctx.margin, ctx.y);
      ctx.y += 10;
      return;
    }

    checkPage(12);
    doc.setFillColor(240, 240, 240);
    doc.rect(ctx.margin, ctx.y - 4, ctx.contentWidth, 8, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Start', ctx.margin + 2, ctx.y);
    doc.text('Frequency', ctx.margin + 55, ctx.y);
    doc.text('End', ctx.margin + 100, ctx.y);
    ctx.y += 8;

    doc.setFont('helvetica', 'normal');
    for (const s of schedules) {
      checkPage(10);
      doc.text(`${s.StartDate} ${s.StartTime}`, ctx.margin + 2, ctx.y);
      doc.text(s.Frequency, ctx.margin + 55, ctx.y);
      doc.text(s.EndDate ? `${s.EndDate} ${s.EndTime || ''}` : '-', ctx.margin + 100, ctx.y);
      ctx.y += 7;
      doc.setDrawColor(230, 230, 230);
      doc.line(ctx.margin, ctx.y - 2, ctx.pageWidth - ctx.margin, ctx.y - 2);
    }
  }

  private renderCurrentPointCloud(
    doc: jsPDF,
    ctx: { y: number; margin: number; pageWidth: number; contentWidth: number },
    points: LidarPoint3D[],
    checkPage: (n: number) => void,
  ): void {
    checkPage(30);
    ctx.y += 10;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Current Point Cloud', ctx.margin, ctx.y);
    ctx.y += 4;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`${points.length.toLocaleString()} point(s)`, ctx.margin, ctx.y);
    doc.setTextColor(0, 0, 0);
    ctx.y += 8;

    if (points.length === 0) {
      doc.setFontSize(11);
      doc.text('No point cloud data available.', ctx.margin, ctx.y);
      ctx.y += 10;
      return;
    }

    const imgWidth = ctx.contentWidth;
    const imgHeight = 100;
    try {
      const png = this.renderPointCloudTopDown(points, imgWidth * 4, imgHeight * 4);
      checkPage(imgHeight + 6);
      doc.addImage(png, 'PNG', ctx.margin, ctx.y, imgWidth, imgHeight);
      ctx.y += imgHeight + 4;
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text('Top-down view (XY projection)', ctx.margin, ctx.y);
      doc.setTextColor(0, 0, 0);
      ctx.y += 8;
    } catch { /* skip image if render fails */ }
  }

  /**
   * Per-scan thumbnails with Started/Finished timing. Fetches each scan's .xyz through the backend
   * proxy, parses client-side, reuses renderPointCloudTopDown. One thumbnail per selected scan.
   */
  private async renderScanCaptures(
    doc: jsPDF,
    ctx: { y: number; margin: number; pageWidth: number; contentWidth: number },
    config: ExportConfig,
    checkPage: (n: number) => void,
    progress?: ExportProgressCallback,
  ): Promise<void> {
    checkPage(30);
    ctx.y += 10;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Scan Captures', ctx.margin, ctx.y);
    ctx.y += 4;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`${config.selectedScans.length} scan(s) selected`, ctx.margin, ctx.y);
    doc.setTextColor(0, 0, 0);
    ctx.y += 8;

    const imgWidth = ctx.contentWidth;
    const imgHeight = 80;
    const parsedClouds: Array<{ record: ProjectScanRecord; points: LidarPoint3D[] }> = [];

    for (let i = 0; i < config.selectedScans.length; i++) {
      const scan = config.selectedScans[i];
      progress?.(i, config.selectedScans.length, scan.Id);

      let points: LidarPoint3D[] = [];
      try {
        const text = await firstValueFrom(
          this.scanService.downloadScanXyz(scan.ProjectId, scan.DeviceId, scan.Id!)
        );
        points = parseXyzText(text);
      } catch {
        points = [];
      }

      checkPage(imgHeight + 20);
      const shortId = (scan.Id || '').slice(0, 8);
      const started = this.formatTimestamp(scan.StartedAt);
      const finished = this.formatTimestamp(scan.FinishedAt);
      const status = scan.Status || '-';
      const caption = `${scan.DeviceName || scan.DeviceId} · ${shortId} · Started ${started} → Finished ${finished} · ${status}`;

      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      const captionLines = doc.splitTextToSize(caption, ctx.contentWidth);
      for (const ln of captionLines) {
        doc.text(ln, ctx.margin, ctx.y);
        ctx.y += 5;
      }
      doc.setFont('helvetica', 'normal');
      ctx.y += 2;

      if (points.length > 0) {
        try {
          const png = this.renderPointCloudTopDown(points, imgWidth * 4, imgHeight * 4);
          doc.addImage(png, 'PNG', ctx.margin, ctx.y, imgWidth, imgHeight);
          ctx.y += imgHeight + 8;
          parsedClouds.push({ record: scan, points });
        } catch {
          doc.setFontSize(9);
          doc.setTextColor(180, 0, 0);
          doc.text('Point cloud render failed.', ctx.margin, ctx.y);
          doc.setTextColor(0, 0, 0);
          ctx.y += 8;
        }
      } else {
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text('Point cloud unavailable.', ctx.margin, ctx.y);
        doc.setTextColor(0, 0, 0);
        ctx.y += 8;
      }
    }
    progress?.(config.selectedScans.length, config.selectedScans.length);

    // Gated: combined overlay of all parsed clouds, color-coded per scan.
    // Requires flattened/aligned .xyz output — stays off until calibration lands.
    if (config.includeOverlapComposite && parsedClouds.length >= 2) {
      this.renderOverlapComposite(doc, ctx, parsedClouds, checkPage);
    }
  }

  private renderOverlapComposite(
    doc: jsPDF,
    ctx: { y: number; margin: number; pageWidth: number; contentWidth: number },
    clouds: Array<{ record: ProjectScanRecord; points: LidarPoint3D[] }>,
    checkPage: (n: number) => void,
  ): void {
    const imgWidth = ctx.contentWidth;
    const imgHeight = 120;
    checkPage(imgHeight + 20);
    ctx.y += 6;
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Combined Overlay', ctx.margin, ctx.y);
    ctx.y += 6;

    const colored: LidarPoint3D[] = [];
    clouds.forEach((c, idx) => {
      const [r, g, b] = SCAN_PALETTE[idx % SCAN_PALETTE.length];
      const tint = `rgb(${r},${g},${b})`;
      for (const p of c.points) colored.push({ ...p, Color: tint });
    });

    try {
      const png = this.renderPointCloudTopDown(colored, imgWidth * 4, imgHeight * 4);
      doc.addImage(png, 'PNG', ctx.margin, ctx.y, imgWidth, imgHeight);
      ctx.y += imgHeight + 6;

      // Legend
      doc.setFontSize(8);
      clouds.forEach((c, idx) => {
        const [r, g, b] = SCAN_PALETTE[idx % SCAN_PALETTE.length];
        doc.setFillColor(r, g, b);
        doc.rect(ctx.margin, ctx.y - 3, 4, 4, 'F');
        doc.setTextColor(60, 60, 60);
        doc.text(
          `${c.record.DeviceName || c.record.DeviceId} · ${(c.record.Id || '').slice(0, 8)}`,
          ctx.margin + 6, ctx.y,
        );
        doc.setTextColor(0, 0, 0);
        ctx.y += 5;
      });
    } catch { /* swallow */ }
  }

  // --- Private helpers (unchanged from original) ---

  private getDeviceStatus(device: DeviceDto): string {
    if (!this.isHeartbeatFresh(device)) return 'offline';

    const services = Object.values(device.HealthReport?.Services ?? {});
    if (services.length === 0) return 'warning';

    const hasDegradedState = services.some((s: any) => {
      const state = (s?.Active ?? '').toLowerCase();
      return state !== 'active' && state !== 'activating';
    });

    return hasDegradedState ? 'warning' : 'online';
  }

  private isHeartbeatFresh(device: DeviceDto): boolean {
    const ts = device.HealthReport?.Timestamp;
    if (!ts) return false;

    const ms = ts < 1e12 ? ts * 1000 : ts;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return false;

    const configuredInterval = Number(device.Config?.HeartbeatInterval);
    const heartbeatIntervalSeconds = Number.isFinite(configuredInterval) && configuredInterval > 0
      ? configuredInterval
      : DEFAULT_HEARTBEAT_INTERVAL_SECONDS;

    const maxAgeMs = Math.max(
      MIN_ONLINE_WINDOW_MS,
      heartbeatIntervalSeconds * 1000 * HEARTBEAT_GRACE_MULTIPLIER,
    );

    return Date.now() - date.getTime() <= maxAgeMs;
  }

  private statusColor(status: string): [number, number, number] {
    switch (status) {
      case 'online': return [34, 139, 34];
      case 'warning': return [200, 150, 0];
      default: return [180, 0, 0];
    }
  }

  private formatTimestamp(ts?: any): string {
    if (ts == null) return '—';
    if (typeof ts === 'number') {
      const ms = ts < 1e12 ? ts * 1000 : ts;
      return new Date(ms).toLocaleString();
    }
    if (typeof ts === 'string') {
      const parsed = Date.parse(ts);
      return Number.isNaN(parsed) ? ts : new Date(parsed).toLocaleString();
    }
    const s = ts.seconds ?? ts._seconds;
    if (typeof s === 'number') return new Date(s * 1000).toLocaleString();
    return '—';
  }

  private renderPointCloudTopDown(points: LidarPoint3D[], width: number, height: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of points) {
      if (p.X < minX) minX = p.X;
      if (p.X > maxX) maxX = p.X;
      if (p.Y < minY) minY = p.Y;
      if (p.Y > maxY) maxY = p.Y;
    }

    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const pad = 20;
    const drawW = width - pad * 2;
    const drawH = height - pad * 2;

    const scale = Math.min(drawW / rangeX, drawH / rangeY);
    const offsetX = pad + (drawW - rangeX * scale) / 2;
    const offsetY = pad + (drawH - rangeY * scale) / 2;

    const pointSize = Math.max(1, Math.min(3, 800 / Math.sqrt(points.length)));
    for (const p of points) {
      const px = offsetX + (p.X - minX) * scale;
      const py = offsetY + (p.Y - minY) * scale;

      if (p.Color) {
        ctx.fillStyle = p.Color;
      } else {
        const brightness = Math.round(140 + (p.Intensity ?? 0.5) * 115);
        ctx.fillStyle = `rgb(${brightness},${brightness},${brightness})`;
      }

      ctx.fillRect(px, py, pointSize, pointSize);
    }

    return canvas.toDataURL('image/png');
  }
}

/** Parse whitespace-separated "x y z [intensity]" lines into LidarPoint3D[]. Caps at 200k points. */
function parseXyzText(text: string): LidarPoint3D[] {
  const MAX = 200_000;
  const lines = text.split(/\r?\n/);
  const out: LidarPoint3D[] = [];
  for (const raw of lines) {
    if (out.length >= MAX) break;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 3) continue;
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    const z = Number(parts[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const intensity = parts.length >= 4 ? Number(parts[3]) : 0.5;
    out.push({
      X: x, Y: y, Z: z,
      Intensity: Number.isFinite(intensity) ? intensity : 0.5,
      Classification: 0,
    });
  }
  return out;
}
