import { Injectable } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { jsPDF } from 'jspdf';

import { ProjectService } from './project-service';
import { DeviceService } from './device-service';
import { ScanService } from './scan-service';
import { VisualizerService, LidarPoint3D } from './visualizer-service';
import { ProjectDto } from '../models/ProjectDto';
import { DeviceDto } from '../models/DeviceDto';
import { ScanScheduleDto } from './scan-service';

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const HEARTBEAT_GRACE_MULTIPLIER = 6;
const MIN_ONLINE_WINDOW_MS = 2 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class ExportService {
  constructor(
    private projectService: ProjectService,
    private deviceService: DeviceService,
    private scanService: ScanService,
    private visualizerService: VisualizerService
  ) {}

  exportProjectPdf(projectId: string): void {
    forkJoin({
      project: this.projectService.getProject(projectId),
      devices: this.deviceService.getDevices(),
      schedules: this.scanService.getSchedules(projectId),
      points: this.visualizerService.getPoints().pipe(catchError(() => of([] as LidarPoint3D[]))),
    }).subscribe({
      next: ({ project, devices, schedules, points }) => {
        const projectDevices = devices.filter(d => d.ProjectId === projectId);
        this.generatePdf(project, projectDevices, schedules, points);
      },
      error: () => {
        this.generatePdf({ Id: projectId, Title: 'Unknown', Description: '', Location: '' }, [], [], []);
      },
    });
  }

  private async generatePdf(project: ProjectDto, devices: DeviceDto[], schedules: ScanScheduleDto[], points: LidarPoint3D[]): Promise<void> {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 20;
    const contentWidth = pageWidth - margin * 2;
    let y = 20;

    const checkPage = (needed: number) => {
      if (y + needed > doc.internal.pageSize.getHeight() - 20) {
        doc.addPage();
        y = 20;
      }
    };

    // --- Header ---
    doc.setFontSize(20);
    doc.setFont('helvetica', 'bold');
    doc.text('Better Placemaking', margin, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`Exported ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 6;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 12;

    // --- Project Info ---
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Project Overview', margin, y);
    y += 10;

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');

    const projectRows = [
      ['Title', project.Title || '-'],
      ['Description', project.Description || '-'],
      ['Location', project.Location || '-'],
    ];

    for (const [label, value] of projectRows) {
      checkPage(8);
      doc.setFont('helvetica', 'bold');
      doc.text(`${label}:`, margin, y);
      doc.setFont('helvetica', 'normal');
      const lines = doc.splitTextToSize(value, contentWidth - 40);
      doc.text(lines, margin + 40, y);
      y += lines.length * 6 + 2;
    }

    y += 8;

    // --- Devices ---
    checkPage(30);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Devices', margin, y);
    y += 4;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`${devices.length} device(s) assigned`, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 8;

    if (devices.length === 0) {
      doc.setFontSize(11);
      doc.text('No devices currently assigned to this project.', margin, y);
      y += 10;
    } else {
      // Table header
      checkPage(12);
      doc.setFillColor(240, 240, 240);
      doc.rect(margin, y - 4, contentWidth, 8, 'F');
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('Device Name', margin + 2, y);
      doc.text('Status', margin + 60, y);
      doc.text('Last Seen', margin + 95, y);
      doc.text('Resolution', margin + 140, y);
      y += 8;

      doc.setFont('helvetica', 'normal');
      for (const device of devices) {
        checkPage(10);
        const status = this.getDeviceStatus(device);
        const lastSeen = this.formatTimestamp(device.HealthReport?.Timestamp);
        const resolution = device.Config?.Camera?.Resolution || '-';

        doc.text(device.Name || device.Id || '-', margin + 2, y);
        doc.setTextColor(...this.statusColor(status));
        doc.text(status, margin + 60, y);
        doc.setTextColor(0, 0, 0);
        doc.text(lastSeen, margin + 95, y);
        doc.text(resolution, margin + 140, y);

        y += 7;
        doc.setDrawColor(230, 230, 230);
        doc.line(margin, y - 2, pageWidth - margin, y - 2);
      }

      // Device services detail
      for (const device of devices) {
        if (!device.HealthReport?.Services) continue;
        checkPage(20);
        y += 6;
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text(`${device.Name || device.Id} — Services`, margin, y);
        y += 6;

        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        for (const [name, svc] of Object.entries(device.HealthReport.Services)) {
          checkPage(7);
          const active = (svc as any)?.Active || 'unknown';
          doc.text(`${name}: ${active}`, margin + 4, y);
          y += 5;
        }
      }
    }

    y += 10;

    // --- Scan Schedules ---
    checkPage(30);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Scan Schedules', margin, y);
    y += 4;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`${schedules.length} schedule(s)`, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 8;

    if (schedules.length === 0) {
      doc.setFontSize(11);
      doc.text('No scan schedules configured.', margin, y);
      y += 10;
    } else {
      checkPage(12);
      doc.setFillColor(240, 240, 240);
      doc.rect(margin, y - 4, contentWidth, 8, 'F');
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('Start', margin + 2, y);
      doc.text('Frequency', margin + 55, y);
      doc.text('End', margin + 100, y);
      y += 8;

      doc.setFont('helvetica', 'normal');
      for (const s of schedules) {
        checkPage(10);
        doc.text(`${s.StartDate} ${s.StartTime}`, margin + 2, y);
        doc.text(s.Frequency, margin + 55, y);
        doc.text(s.EndDate ? `${s.EndDate} ${s.EndTime || ''}` : '-', margin + 100, y);
        y += 7;
        doc.setDrawColor(230, 230, 230);
        doc.line(margin, y - 2, pageWidth - margin, y - 2);
      }
    }

    // --- Point Cloud ---
    checkPage(30);
    y += 10;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Point Cloud', margin, y);
    y += 4;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`${points.length.toLocaleString()} point(s)`, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 8;

    if (points.length === 0) {
      doc.setFontSize(11);
      doc.text('No point cloud data available.', margin, y);
      y += 10;
    } else {
      const imgWidth = contentWidth;
      const imgHeight = 100;

      try {
        const pngDataUrl = this.renderPointCloudTopDown(points, imgWidth * 4, imgHeight * 4);
        checkPage(imgHeight + 6);
        doc.addImage(pngDataUrl, 'PNG', margin, y, imgWidth, imgHeight);
        y += imgHeight + 4;
        doc.setFontSize(8);
        doc.setTextColor(120, 120, 120);
        doc.text('Top-down view (XY projection)', margin, y);
        doc.setTextColor(0, 0, 0);
        y += 8;
      } catch { /* skip image if render fails */ }
    }

    // --- Footer ---
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Better Placemaking — ${project.Title || 'Project'} — Page ${i} of ${totalPages}`,
        pageWidth / 2, doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    // Save
    const safeName = (project.Title || 'project').replace(/[^a-zA-Z0-9]/g, '_');
    doc.save(`${safeName}_report.pdf`);
  }

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

  private formatTimestamp(ts?: number): string {
    if (!ts) return 'Never';
    const ms = ts < 1e12 ? ts * 1000 : ts;
    return new Date(ms).toLocaleString();
  }

  private renderPointCloudTopDown(points: LidarPoint3D[], width: number, height: number): string {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    // Dark background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Compute bounds
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

    // Uniform scale to preserve aspect ratio
    const scale = Math.min(drawW / rangeX, drawH / rangeY);
    const offsetX = pad + (drawW - rangeX * scale) / 2;
    const offsetY = pad + (drawH - rangeY * scale) / 2;

    // Draw points
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
