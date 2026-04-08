import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { PanelModule } from 'primeng/panel';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { DynamicDialogModule, DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { interval, Subject } from 'rxjs';
import { startWith, switchMap, takeUntil } from 'rxjs/operators';
import { FusionService } from '../../../../services/fusion-service';
import { FusionConfigDto, FusionRunDto } from '../../../../models/FusionDtos';
import { FusionModal } from './fusion-modal/fusion-modal';

const POLL_INTERVAL_MS = 8_000;

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
    InputNumberModule,
    ToggleSwitchModule,
    DynamicDialogModule,
  ],
  templateUrl: './fusion.html',
  styleUrls: ['./fusion.scss'],
})
export class Fusion implements OnInit, OnDestroy {
  history: FusionRunDto[] = [];
  historyLoading = true;
  historyError = false;

  config: FusionConfigDto | null = null;
  configLoading = true;
  configError = false;

  editHour = 21;
  editMinute = 0;
  editEnabled = true;
  configSaving = false;
  configSaveSuccess = false;
  configSaveError: string | null = null;

  private readonly destroy$ = new Subject<void>();
  private modalRef: DynamicDialogRef | null = null;

  constructor(
    private readonly fusionService: FusionService,
    private readonly dialogService: DialogService,
  ) {}

  ngOnInit(): void {
    this.loadConfig();

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
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

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

  get scheduledTimeLabel(): string {
    if (!this.config) return '—';
    const h = this.config.scheduledHourUtc;
    const m = this.config.scheduledMinuteUtc;
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${suffix} UTC`;
  }

  get configDirty(): boolean {
    if (!this.config) return false;
    return (
      this.editHour !== this.config.scheduledHourUtc ||
      this.editMinute !== this.config.scheduledMinuteUtc ||
      this.editEnabled !== this.config.enabled
    );
  }

  openFusionModal(): void {
    const ref = this.dialogService.open(FusionModal, {
      header: 'Run Manual Fusion',
      width: '560px',
      modal: true,
      dismissableMask: true,
      closable: true,
      data: {},
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

  saveConfig(): void {
    if (!this.configDirty || this.configSaving) return;

    if (this.editHour < 0 || this.editHour > 23 || this.editMinute < 0 || this.editMinute > 59) {
      this.configSaveError = 'Hour must be 0–23 and minute must be 0–59.';
      return;
    }

    this.configSaving = true;
    this.configSaveError = null;
    this.configSaveSuccess = false;

    this.fusionService
      .updateConfig({
        scheduledHourUtc: this.editHour,
        scheduledMinuteUtc: this.editMinute,
        enabled: this.editEnabled,
      })
      .subscribe({
        next: (updated: FusionConfigDto) => {
          this.config = updated;
          this.configSaving = false;
          this.configSaveSuccess = true;
          setTimeout(() => (this.configSaveSuccess = false), 3000);
        },
        error: () => {
          this.configSaving = false;
          this.configSaveError = 'Failed to save config. Please try again.';
        },
      });
  }

  resetConfig(): void {
    if (!this.config) return;
    this.editHour = this.config.scheduledHourUtc;
    this.editMinute = this.config.scheduledMinuteUtc;
    this.editEnabled = this.config.enabled;
    this.configSaveError = null;
  }

  private loadConfig(): void {
    this.fusionService.getConfig().subscribe({
      next: (cfg: FusionConfigDto) => {
        this.config = cfg;
        this.editHour = cfg.scheduledHourUtc;
        this.editMinute = cfg.scheduledMinuteUtc;
        this.editEnabled = cfg.enabled;
        this.configLoading = false;
      },
      error: () => {
        this.configLoading = false;
        this.configError = true;
      },
    });
  }

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
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleString();
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
    const to = new Date(run.toDateUnix * 1000).toLocaleDateString();
    return from === to ? from : `${from} – ${to}`;
  }
}