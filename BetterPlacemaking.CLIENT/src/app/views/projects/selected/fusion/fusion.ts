import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { PanelModule } from 'primeng/panel';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';
import { DynamicDialogModule, DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { interval, Subject } from 'rxjs';
import { startWith, switchMap, takeUntil } from 'rxjs/operators';
import { FusionService } from '../../../../services/fusion-service';
import { FusionConfigDto, FusionRunDto } from '../../../../models/FusionDtos';
import { FusionModal } from './fusion-modal/fusion-modal';

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
    PanelModule,
    TagModule,
    MessageModule,
    TooltipModule,
    DynamicDialogModule,
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

  private readonly destroy$ = new Subject<void>();
  private modalRef: DynamicDialogRef | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly fusionService: FusionService,
    private readonly dialogService: DialogService,
  ) {}

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('projectId') ?? '';

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

    this.fusionService.getConfig().subscribe({
      next: (cfg: FusionConfigDto) => (this.config = cfg),
      error: () => {},
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ── Computed ──────────────────────────────────────────────────────────────

  get hasRunningFusion(): boolean {
    return this.history.some((r) => r.status === 'running');
  }

  get lastRun(): FusionRunDto | null {
    return this.history[0] ?? null;
  }

  get successCount(): number {
    return this.history.filter((r) => r.status === 'success').length;
  }

  get failedCount(): number {
    return this.history.filter((r) => r.status === 'failed').length;
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  openFusionModal(): void {
    const ref = this.dialogService.open(FusionModal, {
      header: 'Run Manual Fusion',
      width: '520px',
      modal: true,
      dismissableMask: true,
      closable: true,
      data: { projectId: this.projectId },
    });

    if (!ref) return;
    this.modalRef = ref;

  ref.onClose.subscribe((result?: { triggered?: boolean; run?: FusionRunDto }) => {
      if (result?.triggered && result.run) {
        // INSTANTLY show the new run at the top
        this.history = [result.run, ...this.history];
      }
  });
}

  deleteRun(run: FusionRunDto, event: Event): void {
    event.stopPropagation();
    if (run.status === 'running') return;

    this.deletingRunId = run.id;
    this.fusionService.deleteRun(run.id).subscribe({
      next: () => {
        this.history = this.history.filter((r) => r.id !== run.id);
        this.deletingRunId = null;
      },
      error: () => (this.deletingRunId = null),
    });
  }

  downloadRun(run: FusionRunDto, event: Event): void {
    event.stopPropagation();
    if (!run.outputGcsPath) return;

    this.downloadingRunId = run.id;
    this.fusionService.getDownloadUrl(run.id).subscribe({
      next: (res) => {
        window.open(res.url, '_blank');
        this.downloadingRunId = null;
      },
      error: () => (this.downloadingRunId = null),
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  runStatusSeverity(status: string): 'success' | 'danger' | 'info' | 'secondary' {
    if (status === 'success') return 'success';
    if (status === 'failed') return 'danger';
    if (status === 'running') return 'info';
    return 'secondary';
  }

  runStatusIcon(status: string): string {
    if (status === 'success') return 'pi pi-check-circle';
    if (status === 'failed') return 'pi pi-times-circle';
    if (status === 'running') return 'pi pi-spin pi-spinner';
    return 'pi pi-question-circle';
  }

  formatUnix(unix?: number): string {
    if (!unix) return '—';
    const date = new Date(unix * 1000);
    return isNaN(date.getTime()) ? '—' : date.toLocaleString();
  }

  formatDuration(run: FusionRunDto): string {
    if (!run.startedAtUnix || !run.completedAtUnix) return '—';
    const secs = Math.round(run.completedAtUnix - run.startedAtUnix);
    if (secs < 60) return `${secs}s`;
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  formatDateRange(run: FusionRunDto): string {
    if (!run.fromDateUnix || !run.toDateUnix) return '—';
    const from = new Date(run.fromDateUnix * 1000).toLocaleDateString();
    const to   = new Date(run.toDateUnix   * 1000).toLocaleDateString();
    return from === to ? from : `${from} – ${to}`;
  }
}
