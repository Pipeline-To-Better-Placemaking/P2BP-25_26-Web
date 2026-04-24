import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';
import { TableModule } from 'primeng/table';
import { DatePickerModule } from 'primeng/datepicker'; // NEW
import { DialogModule } from 'primeng/dialog';       // NEW
import { DynamicDialogModule, DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { interval, Subject } from 'rxjs';
import { startWith, switchMap, takeUntil } from 'rxjs/operators';
import { ActivatedRoute } from '@angular/router';
import { FusionService } from '../../../../services/fusion-service';
import { FusionConfigDto, FusionRunDto } from '../../../../models/FusionDtos';
import { FusionModal } from './fusion-modal/fusion-modal';
import { PermissionDirective } from '../../../../directives/permission.directive';

const POLL_INTERVAL_MS = 6_000;

@Component({
  selector: 'app-fusion',
  standalone: true,
  providers: [DialogService],
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    TagModule,
    MessageModule,
    TooltipModule,
    TableModule,
    DatePickerModule,     // NEW
    DialogModule,         // NEW
    DynamicDialogModule,
    PermissionDirective,
  ],
  templateUrl: './fusion.html',
  styleUrls: ['./fusion.scss'],
})
export class Fusion implements OnInit, OnDestroy {
  projectId = '';
  history: FusionRunDto[] = [];
  historyLoading = true;
  historyError = false;
  config: FusionConfigDto | null = null;
  deletingRunId: string | null = null;
  downloadingRunId: string | null = null;
  cancellingRunId: string | null = null;

  // ── Schedule dialog ────────────────────────────────────────────────────────
  scheduleDialogVisible = false;
  scheduleDialogSaving  = false;
  scheduleDialogError   = false;
  scheduleDialogTime: Date | null = null;

  private readonly destroy$ = new Subject<void>();
  private modalRef: DynamicDialogRef | null = null;

  constructor(
    private readonly fusionService: FusionService,
    private readonly dialogService: DialogService,
    private readonly route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    interval(POLL_INTERVAL_MS)
      .pipe(
        startWith(0),
        switchMap(() => this.fusionService.getHistory()),
        takeUntil(this.destroy$),
      )
      .subscribe({
        next: (runs: FusionRunDto[]) => {
          this.history = runs;
          this.historyLoading = false;
          this.historyError = false;
        },
        error: () => {
          this.historyLoading = false;
          this.historyError = true;
        },
      });

    this.projectId = this.route.snapshot.paramMap.get('projectId') ?? '';
    this.fusionService.getConfig(this.projectId || undefined).subscribe({
      next: (cfg: FusionConfigDto) => (this.config = cfg),
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get hasRunningFusion(): boolean {
    return this.history.some((r) => r.Status === 'running' || r.Status === 'cancelling');
  }

  get lastRun(): FusionRunDto | null {
    return this.history[0] ?? null;
  }

  get successCount(): number {
    return this.history.filter((r) => r.Status === 'success').length;
  }

  get failedCount(): number {
    return this.history.filter((r) => r.Status === 'failed').length;
  }

  openFusionModal(): void {
    const ref = this.dialogService.open(FusionModal, {
      header: 'Run Manual Fusion',
      width: '900px',
      height: 'auto',
      modal: true,
      dismissableMask: true,
      closable: true,
      contentStyle: {
        'max-height': '900vh',
        'overflow': 'auto'
      },
      style: {
        'min-height': '600px'
      },
      data: { projectId: this.projectId || undefined },
    });
    if (!ref) return;
    this.modalRef = ref;
    ref.onClose.subscribe((result?: { triggered?: boolean }) => {
      if (result?.triggered) {
        this.fusionService.getHistory().subscribe({
          next: (runs: FusionRunDto[]) => (this.history = runs),
        });
      }
    });
  }

openScheduleDialog(): void {
    this.scheduleDialogError   = false;
    this.scheduleDialogVisible = true;
    this.scheduleDialogTime    = null; // placeholder while we fetch

    this.fusionService.getConfig(this.projectId || undefined).subscribe({
      next: (cfg) => {
        this.config = cfg;
        const d = new Date();
        d.setHours(cfg.ScheduledHourUtc, cfg.ScheduledMinuteUtc, 0, 0);
        this.scheduleDialogTime = d;
      },
      error: () => (this.scheduleDialogError = true),
    });
}

  saveScheduleTime(): void {
    if (!this.scheduleDialogTime) return;
    this.scheduleDialogSaving = true;
    this.scheduleDialogError  = false;

   const projectId = this.projectId || this.config?.ProjectId;

    this.fusionService.updateConfig({
      ScheduledHourUtc:   this.scheduleDialogTime.getHours(),
      ScheduledMinuteUtc: this.scheduleDialogTime.getMinutes(),
      Enabled:            this.config?.Enabled ?? true,
      ProjectId:          projectId,
    }).subscribe({
      next: (updated) => {
        this.config = updated;
        this.scheduleDialogSaving  = false;
        this.scheduleDialogVisible = false;
      },
      error: () => {
        this.scheduleDialogSaving = false;
        this.scheduleDialogError  = true;
      },
    });
  }

  formatScheduleTime(config: FusionConfigDto): string {
    const h = String(config.ScheduledHourUtc).padStart(2, '0');
    const m = String(config.ScheduledMinuteUtc).padStart(2, '0');
    return `${h}:${m}`;
  }

  // ── Existing methods (unchanged) ──────────────────────────────────────────
  cancelRun(run: FusionRunDto, event: Event): void {
    event.stopPropagation();
    if (run.Status !== 'running') return;

    this.cancellingRunId = run.Id;

    this.fusionService.cancelRun(run.Id).subscribe({
      next: () => {
        this.history = this.history.map((r) =>
          r.Id === run.Id ? { ...r, Status: 'cancelling' } : r,
        );
        this.cancellingRunId = null;
      },
      error: () => {
        this.cancellingRunId = null;
      },
    });
  }

  deleteRun(run: FusionRunDto, event: Event): void {
    event.stopPropagation();
    if (run.Status === 'running') return;
    this.deletingRunId = run.Id;
    this.fusionService.deleteRun(run.Id).subscribe({
      next: () => {
        this.history = this.history.filter((r) => r.Id !== run.Id);
        this.deletingRunId = null;
      },
      error: () => (this.deletingRunId = null),
    });
  }

  downloadRun(run: FusionRunDto, event: Event): void {
    event.stopPropagation();
    if (!run.OutputGcsPath) return;
    this.downloadingRunId = run.Id;
    this.fusionService.downloadRun(run.Id).subscribe({
      next: (blob) => {
        const filename = run.OutputGcsPath!.split('/').pop() ?? 'fused_tracks.json';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        this.downloadingRunId = null;
      },
      error: () => (this.downloadingRunId = null),
    });
  }

 runStatusSeverity(status: string): 'success' | 'danger' | 'info' | 'warn' | 'secondary' {
    if (status === 'success')    return 'success';
    if (status === 'failed')     return 'danger';
    if (status === 'running')    return 'info';
    if (status === 'cancelling') return 'warn';
    if (status === 'cancelled')  return 'secondary';
    return 'secondary';
  }

  runStatusIcon(status: string): string {
    if (status === 'success')    return 'pi pi-check-circle';
    if (status === 'failed')     return 'pi pi-times-circle';
    if (status === 'running')    return 'pi pi-spin pi-spinner';
    if (status === 'cancelling') return 'pi pi-spin pi-spinner';
    if (status === 'cancelled')  return 'pi pi-ban';
    return 'pi pi-question-circle';
  }

  formatUnix(unix?: number): string {
    if (!unix) return '—';
    const date = new Date(unix * 1000);
    return isNaN(date.getTime()) ? '—' : date.toLocaleString();
  }

  formatDuration(run: FusionRunDto): string {
    if (!run.StartedAtUnix || !run.CompletedAtUnix) return '—';
    const secs = Math.round(run.CompletedAtUnix - run.StartedAtUnix);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  formatDateRange(run: FusionRunDto): string {
    if (!run.FromDateUnix || !run.ToDateUnix) return '—';
    const from = new Date(run.FromDateUnix * 1000).toLocaleDateString();
    const to   = new Date(run.ToDateUnix   * 1000).toLocaleDateString();
    return from === to ? from : `${from} – ${to}`;
  }
}
