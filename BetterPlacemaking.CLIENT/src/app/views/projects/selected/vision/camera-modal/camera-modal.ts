import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { InputTextModule } from 'primeng/inputtext';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { Subject, BehaviorSubject, interval, forkJoin } from 'rxjs';
import { switchMap, startWith, takeUntil } from 'rxjs/operators';
import { DeviceService } from '../../../../../services/device-service';
import { DeviceDto } from '../../../../../models/DeviceDto';
import { CameraInfo, IntrinsicsCalibrationState } from '../../../../../models/jetson-dtos/HealthReport';
import { BoardService } from '../../../../../services/board-service';
import { BoardLibraryItem } from '../../../../../models/BoardLibrary';
import { HomographyService } from '../../../../../services/homography-service';

/** Poll rate while the Jetson is actively collecting intrinsics sightings (matches its fast heartbeat). */
const CALIBRATING_POLL_MS = 2_000;
/** Minimum normal poll rate regardless of configured heartbeat interval. */
const MIN_POLL_INTERVAL_MS = 5_000;

@Component({
  selector: 'app-camera-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TagModule,
    MessageModule,
    InputTextModule,
    TooltipModule,
    SelectModule,
  ],
  templateUrl: './camera-modal.html',
})
export class CameraModal implements OnInit, OnDestroy {
  device: DeviceDto | null = null;
  mac = '';
  camInfo: CameraInfo | null = null;
  intrinsics: IntrinsicsCalibrationState | null = null;
  homographyReady = false;
  allDevices: DeviceDto[] = [];

  nickname = '';
  editingNickname = false;
  nicknameInput = '';

  intrinsicsActionMessage: string | null = null;
  intrinsicsError = false;
  triggerLoading = false;

  homographyLoading = false;
  homographyTriggered = false;
  homographyError = false;

  snapshotUrl: string | null = null;
  snapshotLoading = true;

  boardLibrary: BoardLibraryItem[] = [];
  selectedBoard: BoardLibraryItem | null = null;

  lastUpdated: Date | null = null;

  private readonly destroy$ = new Subject<void>();
  private readonly pollRate$ = new BehaviorSubject<number>(MIN_POLL_INTERVAL_MS);
  private normalPollMs = MIN_POLL_INTERVAL_MS;

  constructor(
    private readonly config: DynamicDialogConfig,
    private readonly ref: DynamicDialogRef,
    private readonly deviceService: DeviceService,
    private readonly boardService: BoardService,
    private readonly homographyService: HomographyService,
  ) {}

  ngOnInit(): void {
    const data = (this.config.data ?? {}) as {
      device?: DeviceDto;
      mac?: string;
      camInfo?: CameraInfo;
      intrinsics?: IntrinsicsCalibrationState | null;
      homographyReady?: boolean;
      allDevices?: DeviceDto[];
    };
    this.device = data.device ?? null;
    this.mac = data.mac ?? '';
    this.camInfo = data.camInfo ?? null;
    this.intrinsics = data.intrinsics ?? null;
    this.homographyReady = data.homographyReady ?? false;
    this.allDevices = data.allDevices ?? (this.device ? [this.device] : []);
    this.nickname = localStorage.getItem(`cam-nickname-${this.mac}`) ?? '';

    this.boardService.getLibrary().subscribe({
      next: (items) => { this.boardLibrary = items; },
      error: () => { this.boardLibrary = []; },
    });

    if (this.device?.Id && this.mac) {
      this.homographyService.getSnapshotUrl(this.device.Id, this.mac).subscribe({
        next: (url) => { this.snapshotUrl = url; this.snapshotLoading = false; },
        error: () => { this.snapshotLoading = false; },
      });
    } else {
      this.snapshotLoading = false;
    }

    if (this.device?.Id) {
      this.normalPollMs = Math.max(MIN_POLL_INTERVAL_MS, (this.device.Config?.HeartbeatInterval ?? 30) * 1000);

      // Start fast if already collecting when modal opens
      const initialRate = this.intrinsics?.Status === 'collecting' ? CALIBRATING_POLL_MS : this.normalPollMs;
      this.pollRate$.next(initialRate);

      // Whenever pollRate$ changes, tear down the old interval and start a new one.
      // startWith(0) inside ensures an immediate fetch each time the rate switches.
      this.pollRate$.pipe(
        switchMap((ms) => interval(ms).pipe(startWith(0))),
        switchMap(() => this.deviceService.getDevice(this.device!.Id)),
        takeUntil(this.destroy$),
      ).subscribe({
        next: (updated) => {
          this.device = updated;
          this.intrinsics = updated.HealthReport?.IntrinsicsCalibration?.[this.mac] ?? null;
          this.lastUpdated = new Date();

          const shouldPollFast = this.isIntrinsicsEnabled || this.intrinsicsStatus === 'collecting';
          if (shouldPollFast && this.pollRate$.value !== CALIBRATING_POLL_MS) {
            this.pollRate$.next(CALIBRATING_POLL_MS);
          }

          if (!shouldPollFast && this.pollRate$.value !== this.normalPollMs) {
            this.pollRate$.next(this.normalPollMs);
          }
        },
        error: () => { /* silently ignore — stale data is fine */ },
      });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get charucoBoards(): BoardLibraryItem[] {
    return this.boardLibrary.filter((b) => b.Type === 'charuco');
  }

  get resolution(): string {
    const res = this.camInfo?.Resolution;
    if (!Array.isArray(res) || res.length < 2) return '—';
    return `${res[0]} × ${res[1]}`;
  }

  get coverageGrid(): number[] {
    return this.intrinsics?.CoverageGrid ?? [];
  }

  get coverageGridCols(): number {
    const len = this.coverageGrid.length;
    if (len === 0) return 0;
    return Math.ceil(Math.sqrt(len));
  }

  get coverageFilled(): number {
    return this.coverageGrid.filter((v) => !!v).length;
  }

  get intrinsicsStatus(): string {
    return this.intrinsics?.Status ?? 'none';
  }

  get isIntrinsicsEnabled(): boolean {
    return this.device?.Config?.Intrinsics?.BeginCalibration === true;
  }

  get intrinsicsButtonLabel(): string {
    if (this.isIntrinsicsEnabled) {
      return 'Stop';
    }

    return this.intrinsicsStatus === 'done' ? 'Run Again' : 'Run';
  }

  get intrinsicsButtonIcon(): string {
    return this.isIntrinsicsEnabled ? 'pi pi-stop' : 'pi pi-play';
  }

  get intrinsicsButtonSeverity(): 'primary' | 'danger' {
    return this.isIntrinsicsEnabled ? 'danger' : 'primary';
  }

  get intrinsicsSeverity(): 'success' | 'info' | 'secondary' {
    if (this.intrinsicsStatus === 'done') return 'success';
    if (this.intrinsicsStatus === 'collecting') return 'info';
    return 'secondary';
  }

  get hasSuggestion(): boolean {
    return !!(this.intrinsics?.SuggestedRegion || this.intrinsics?.SuggestedTilt);
  }

  get suggestionText(): string {
    const parts: string[] = [];
    if (this.intrinsics?.SuggestedRegion) parts.push(`Move the board to the ${this.intrinsics.SuggestedRegion} of the camera frame.`);
    if (this.intrinsics?.SuggestedTilt) parts.push(`Suggested tilt: ${this.intrinsics.SuggestedTilt}.`);
    return parts.join(' ');
  }

  get canRunHomography(): boolean {
    return this.intrinsicsStatus === 'done' && !!this.selectedBoard;
  }

  get homographyStatusLabel(): string {
    if (this.homographyReady) return 'Ready';
    if (this.homographyLoading || this.homographyTriggered) return 'Scanning';
    return 'Missing';
  }

  get homographySeverity(): 'success' | 'info' | 'secondary' {
    if (this.homographyReady) return 'success';
    if (this.homographyLoading || this.homographyTriggered) return 'info';
    return 'secondary';
  }

  get homographyStatusDetail(): string {
    if (this.homographyReady) return 'Local homography found for this camera.';
    if (this.homographyLoading || this.homographyTriggered) return 'Homography scan in progress.';
    return 'No local homography found for this camera yet.';
  }

  get arucoStatus(): string {
    return (this.device?.Config?.ArucoLock?.Status ?? 'unlocked').toLowerCase();
  }

  get arucoStatusLabel(): string {
    if (this.arucoStatus === 'locked') return 'Locked';
    if (this.arucoStatus === 'scanning') return 'Scanning';
    if (this.arucoStatus === 'failed' || this.arucoStatus === 'error') return 'Failed';
    return 'Unlocked';
  }

  get arucoSeverity(): 'success' | 'warn' | 'danger' | 'secondary' {
    if (this.arucoStatus === 'locked') return 'success';
    if (this.arucoStatus === 'scanning') return 'warn';
    if (this.arucoStatus === 'failed' || this.arucoStatus === 'error') return 'danger';
    return 'secondary';
  }

  get arucoStatusDetail(): string {
    if (this.arucoStatus === 'locked') return 'Device origin is established.';
    if (this.arucoStatus === 'scanning') return 'ArUco lock scan is in progress on this device.';
    if (this.arucoStatus === 'failed' || this.arucoStatus === 'error') return 'Last ArUco lock scan failed.';
    return 'Run from the device card to establish origin.';
  }

  get lastUpdatedLabel(): string {
    if (!this.lastUpdated) return '';
    const diffMs = Date.now() - this.lastUpdated.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    return `${Math.floor(diffSec / 60)}m ago`;
  }

  startEditNickname(): void {
    this.nicknameInput = this.nickname;
    this.editingNickname = true;
  }

  saveNickname(): void {
    const trimmed = this.nicknameInput.trim();
    if (trimmed) {
      localStorage.setItem(`cam-nickname-${this.mac}`, trimmed);
      this.nickname = trimmed;
    } else {
      localStorage.removeItem(`cam-nickname-${this.mac}`);
      this.nickname = '';
    }
    this.editingNickname = false;
    this.ref.close({ nicknameChanged: true });
  }

  cancelEditNickname(): void {
    this.editingNickname = false;
  }

  toggleIntrinsics(): void {
    if (!this.device?.Id) return;

    const nextEnabled = !this.isIntrinsicsEnabled;

    this.triggerLoading = true;
    this.intrinsicsError = false;
    this.intrinsicsActionMessage = null;

    const existingConfig = this.device.Config ?? { HeartbeatInterval: 30 };
    const board = this.selectedBoard;
    const updated: DeviceDto = {
      ...this.device,
      Config: {
        ...existingConfig,
        CharucoBoard: nextEnabled && board
          ? {
              ...existingConfig.CharucoBoard,
              BeginScanning: existingConfig.CharucoBoard?.BeginScanning ?? false,
              Board: {
                SquaresX: board.Cols ?? 7,
                SquaresY: board.Rows ?? 5,
                SquareSize: board.SquareSizeMm ?? 40,
                ArucoSize: board.MarkerSizeMm,
                Dictionary: board.Dictionary,
              },
            }
          : (existingConfig.CharucoBoard ?? { BeginScanning: false }),
        Intrinsics: {
          ...existingConfig.Intrinsics,
          BeginCalibration: nextEnabled,
        },
      },
    };

    this.deviceService.updateDevice(this.device.Id, updated).subscribe({
      next: (saved) => {
        this.device = saved;
        this.intrinsics = saved.HealthReport?.IntrinsicsCalibration?.[this.mac] ?? this.intrinsics;
        this.intrinsicsActionMessage = nextEnabled
          ? 'Intrinsics calibration enabled. It will remain enabled until calibration completes or you stop it.'
          : 'Intrinsics calibration disabled.';
        this.triggerLoading = false;

        this.pollRate$.next(nextEnabled ? CALIBRATING_POLL_MS : this.normalPollMs);
      },
      error: () => {
        this.intrinsicsError = true;
        this.triggerLoading = false;
      },
    });
  }

  triggerHomography(): void {
    if (!this.selectedBoard || this.homographyLoading) return;
    this.homographyLoading = true;
    this.homographyError = false;

    const board = this.selectedBoard;
    const boardDetails = {
      SquaresX: board.Cols ?? 7,
      SquaresY: board.Rows ?? 5,
      SquareSize: board.SquareSizeMm ?? 40,
      ArucoSize: board.MarkerSizeMm,
      Dictionary: board.Dictionary,
    };

    const updates = this.allDevices
      .filter((d) => d.Id && d.Config)
      .map((d) =>
        this.deviceService.updateDevice(d.Id, {
          ...d,
          Config: {
            ...d.Config!,
            CharucoBoard: {
              ...d.Config!.CharucoBoard,
              BeginScanning: true,
              Board: boardDetails,
            },
          },
        }),
      );

    if (updates.length === 0) {
      this.homographyLoading = false;
      return;
    }

    forkJoin(updates).subscribe({
      next: () => {
        this.homographyTriggered = true;
        this.homographyLoading = false;
      },
      error: () => {
        this.homographyError = true;
        this.homographyLoading = false;
      },
    });
  }
}
