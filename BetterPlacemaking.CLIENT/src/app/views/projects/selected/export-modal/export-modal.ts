import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DatePickerModule } from 'primeng/datepicker';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ScanService, ProjectScanRecord } from '../../../../services/scan-service';
import { ExportConfig, ExportService } from '../../../../services/export-service';

interface QuickPick {
  key: 'last5' | 'last10' | 'days30' | 'allComplete';
  label: string;
}

@Component({
  selector: 'app-export-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    DatePickerModule,
    InputTextModule,
    TableModule,
    TagModule,
    TooltipModule,
  ],
  templateUrl: './export-modal.html',
})
export class ExportModal implements OnInit {
  projectId!: string;

  title = '';
  notes = '';

  sections = {
    overview: true,
    devices: true,
    schedules: true,
    currentPointCloud: true,
    scanCaptures: true,
  };

  dateFrom: Date | null = null;
  dateTo: Date | null = null;

  includeOverlapComposite = false;

  allScans: ProjectScanRecord[] = [];
  selectedScans: ProjectScanRecord[] = [];
  loadingScans = false;
  scanLoadError = false;

  generating = false;
  progressLabel = '';
  progressDone = 0;
  progressTotal = 0;

  readonly quickPicks: QuickPick[] = [
    { key: 'last5', label: 'Last 5' },
    { key: 'last10', label: 'Last 10' },
    { key: 'days30', label: 'Last 30 days' },
    { key: 'allComplete', label: 'All complete (in range)' },
  ];

  constructor(
    private readonly config: DynamicDialogConfig,
    private readonly ref: DynamicDialogRef,
    private readonly scanService: ScanService,
    private readonly exportService: ExportService,
    private readonly messageService: MessageService,
  ) {}

  ngOnInit(): void {
    const data = (this.config.data ?? {}) as { projectId?: string };
    this.projectId = data.projectId ?? '';
    if (!this.projectId) {
      this.scanLoadError = true;
      return;
    }
    this.loadingScans = true;
    this.scanService.getScansForProject(this.projectId).subscribe({
      next: scans => {
        this.allScans = scans;
        this.loadingScans = false;
        this.applyQuickPick('last5');
      },
      error: () => {
        this.loadingScans = false;
        this.scanLoadError = true;
      },
    });
  }

  /** Scans visible under the current date-range filter. */
  get visibleScans(): ProjectScanRecord[] {
    const fromMs = this.dateFrom ? startOfDay(this.dateFrom).getTime() : -Infinity;
    const toMs = this.dateTo ? endOfDay(this.dateTo).getTime() : Infinity;
    return this.allScans.filter(s => {
      const t = toMillis(s.FinishedAt ?? s.CreatedAt);
      return t >= fromMs && t <= toMs;
    });
  }

  get selectionCount(): number {
    return this.selectedScans.length;
  }

  get canGenerate(): boolean {
    return !this.generating && !this.loadingScans;
  }

  onDateRangeChange(): void {
    // Drop any selected scans that fell out of range
    const visibleIds = new Set(this.visibleScans.map(s => s.Id));
    this.selectedScans = this.selectedScans.filter(s => visibleIds.has(s.Id));
  }

  applyQuickPick(key: QuickPick['key']): void {
    if (key === 'days30') {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 30);
      this.dateFrom = from;
      this.dateTo = to;
    }
    const pool = this.visibleScans;
    if (key === 'last5') {
      this.selectedScans = pool.slice(0, 5);
    } else if (key === 'last10') {
      this.selectedScans = pool.slice(0, 10);
    } else if (key === 'days30') {
      this.selectedScans = [...pool];
    } else if (key === 'allComplete') {
      this.selectedScans = pool.filter(s => (s.Status || '').toLowerCase() === 'complete');
    }
  }

  statusSeverity(status?: string): 'success' | 'warn' | 'danger' | 'info' | 'secondary' {
    const s = (status || '').toLowerCase();
    if (s === 'complete') return 'success';
    if (s === 'running' || s === 'pending') return 'info';
    if (s === 'failed' || s === 'error') return 'danger';
    return 'secondary';
  }

  formatTimestamp(v: any): string {
    const ms = toMillis(v);
    return ms > 0 ? new Date(ms).toLocaleString() : '—';
  }

  shortId(id?: string): string {
    return (id || '').slice(0, 8);
  }

  cancel(): void {
    this.ref.close();
  }

  async generate(): Promise<void> {
    if (!this.canGenerate) return;
    this.generating = true;
    this.progressDone = 0;
    this.progressTotal = this.sections.scanCaptures ? this.selectedScans.length : 0;

    const config: ExportConfig = {
      projectId: this.projectId,
      title: this.title.trim() || undefined,
      notes: this.notes.trim() || undefined,
      sections: { ...this.sections },
      dateRange: {
        from: this.dateFrom ?? undefined,
        to: this.dateTo ?? undefined,
      },
      selectedScans: this.sections.scanCaptures ? this.selectedScans : [],
      includeOverlapComposite: this.includeOverlapComposite,
    };

    try {
      await this.exportService.exportProjectPdfWithConfig(config, (done, total, label) => {
        this.progressDone = done;
        this.progressTotal = total;
        this.progressLabel = label ?? '';
      });
      this.messageService.add({
        severity: 'success',
        summary: 'Export Ready',
        detail: 'PDF downloaded.',
        life: 3000,
      });
      this.ref.close({ exported: true });
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Export Failed',
        detail: 'Unable to generate PDF.',
        life: 5000,
      });
    } finally {
      this.generating = false;
    }
  }
}

function toMillis(v: any): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v < 1e12 ? v * 1000 : v;
  if (typeof v === 'string') {
    const parsed = Date.parse(v);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  const s = v.seconds ?? v._seconds;
  if (typeof s === 'number') return s * 1000;
  return 0;
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}
