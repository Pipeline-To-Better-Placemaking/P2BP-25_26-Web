import { Injectable } from '@angular/core';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { jsPDF } from 'jspdf';

import { ProjectService } from './project-service';
import { DeviceService } from './device-service';
import { ScanService } from './scan-service';
import { BoardService } from './board-service';
import { ProjectDto } from '../models/ProjectDto';
import { DeviceDto } from '../models/DeviceDto';
import { ScanScheduleDto } from './scan-service';
import { BoardLibraryItem } from '../models/BoardLibrary';

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const HEARTBEAT_GRACE_MULTIPLIER = 6;
const MIN_ONLINE_WINDOW_MS = 2 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class ExportService {
  constructor(
    private projectService: ProjectService,
    private deviceService: DeviceService,
    private scanService: ScanService,
    private boardService: BoardService
  ) {}

  exportProjectPdf(projectId: string): void {
    forkJoin({
      project: this.projectService.getProject(projectId),
      devices: this.deviceService.getDevices(),
      schedules: this.scanService.getSchedules(projectId),
      boards: this.boardService.getLibrary().pipe(catchError(() => of([] as BoardLibraryItem[]))),
    }).subscribe({
      next: ({ project, devices, schedules, boards }) => {
        const projectDevices = devices.filter(d => d.ProjectId === projectId);
        this.generatePdf(project, projectDevices, schedules, boards);
      },
      error: () => {
        this.generatePdf({ Id: projectId, Title: 'Unknown', Description: '', Location: '' }, [], [], []);
      },
    });
  }

  private async generatePdf(project: ProjectDto, devices: DeviceDto[], schedules: ScanScheduleDto[], boards: BoardLibraryItem[]): Promise<void> {
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

    // --- Board Library ---
    checkPage(30);
    y += 10;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Board Library', margin, y);
    y += 4;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text(`${boards.length} board(s) saved`, margin, y);
    doc.setTextColor(0, 0, 0);
    y += 8;

    if (boards.length === 0) {
      doc.setFontSize(11);
      doc.text('No boards in library.', margin, y);
      y += 10;
    } else {
      const boardImageWidth = 60;
      const boardImageMaxHeight = 60;

      for (const board of boards) {
        const label = board.Nickname || `${board.Type} board`;
        const dictLabel = board.Dictionary;
        const sizeLabel = board.Type === 'charuco'
          ? `${board.Cols}x${board.Rows} squares, marker ${board.MarkerSizeMm}mm`
          : `Marker #${board.MarkerId}, ${board.MarkerSizeMm}mm`;

        let pngDataUrl: string | null = null;
        if (board.PreviewSvg) {
          try {
            pngDataUrl = await this.renderSvgToPng(board.PreviewSvg, 480, 480);
          } catch { /* skip image if render fails */ }
        }

        const blockHeight = pngDataUrl ? Math.max(boardImageMaxHeight + 10, 30) : 24;
        checkPage(blockHeight);

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');
        doc.text(label, margin, y);
        y += 6;
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`${dictLabel}  •  ${sizeLabel}`, margin, y);
        y += 6;

        if (pngDataUrl) {
          const aspectRatio = board.Type === 'charuco' && board.Cols && board.Rows
            ? board.Cols / board.Rows
            : 1;
          let imgW = boardImageWidth;
          let imgH = imgW / aspectRatio;
          if (imgH > boardImageMaxHeight) {
            imgH = boardImageMaxHeight;
            imgW = imgH * aspectRatio;
          }

          checkPage(imgH + 6);
          doc.addImage(pngDataUrl, 'PNG', margin, y, imgW, imgH);
          y += imgH + 6;
        }

        doc.setDrawColor(230, 230, 230);
        doc.line(margin, y, pageWidth - margin, y);
        y += 6;
      }
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

  private renderSvgToPng(svg: string, width: number, height: number): Promise<string> {
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const objectUrl = URL.createObjectURL(svgBlob);

    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) { reject(new Error('Canvas context unavailable')); return; }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/png'));
        } finally {
          URL.revokeObjectURL(objectUrl);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to load SVG'));
      };
      img.src = objectUrl;
    });
  }
}
