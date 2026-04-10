import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { CardModule } from 'primeng/card';
import { PanelModule } from 'primeng/panel';
import { TagModule } from 'primeng/tag';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';
import { DynamicDialogModule, DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { DeviceService } from '../../../../services/device-service';
import { DeviceDto } from '../../../../models/DeviceDto';
import { CameraInfo, IntrinsicsCalibrationState } from '../../../../models/jetson-dtos/HealthReport';
import { CameraModal } from './camera-modal/camera-modal';
import { DeviceModal } from './device-modal/device-modal';
import { BoardGenerateModal } from './board-generate-modal/board-generate-modal';
import { BoardDetailModal } from './board-detail-modal/board-detail-modal';
import { BoardService } from '../../../../services/board-service';
import { BoardLibraryItem } from '../../../../models/BoardLibrary';
import { HomographyService, GlobalHomographySetDto } from '../../../../services/homography-service';
import { FloorplanService, FloorplanItem } from '../../../../services/floorplan-service';
import { interval, Subject } from 'rxjs';
import { takeUntil, startWith } from 'rxjs/operators';
import { VisionTutorialComponent } from './vision-tutorial/vision-tutorial';


const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const POLL_INTERVAL_MS = 30_000;
const HEARTBEAT_GRACE_MULTIPLIER = 6;
const MIN_ONLINE_WINDOW_MS = 2 * 60 * 1000;

export interface CameraEntry {
  device: DeviceDto;
  mac: string;
  info: CameraInfo;
  intrinsics: IntrinsicsCalibrationState | null;
  nickname: string;
  index: number;
}

@Component({
  selector: 'app-vision',
  standalone: true,
  providers: [DialogService],
  imports: [
    CommonModule,
    CardModule,
    PanelModule,
    TagModule,
    ButtonModule,
    MessageModule,
    TooltipModule,
    DynamicDialogModule,
    VisionTutorialComponent,
  ],
  templateUrl: './vision.html',
  styleUrls: ['./vision.scss'],
})
export class Vision implements OnInit, OnDestroy {
  projectId = '';
  devices: DeviceDto[] = [];
  loading = true;
  boardLibrary: BoardLibraryItem[] = [];
  boardLibraryLoading = false;
  boardLibraryError = false;
  hasLocalHomographies = false;
  puzzleReady = false;
  puzzlePiecesTotal = 0;
  puzzlePiecesReady = 0;
  private homographyCameraKeys = new Set<string>();
  globalHomographies: GlobalHomographySetDto | null = null;
  floorplans: FloorplanItem[] = [];
  floorplansLoading = false;
  uploadingFloorplan = false;
  selectedFloorplanId: string | null = null;



  showTutorial = false;
  private readonly TOUR_KEY = 'vision-tutorial-seen';

  private readonly destroy$ = new Subject<void>();

  private camRef: DynamicDialogRef | null = null;
  private deviceRef: DynamicDialogRef | null = null;
  private boardGenRef: DynamicDialogRef | null = null;
  private boardDetailRef: DynamicDialogRef | null = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly deviceService: DeviceService,
    private readonly boardService: BoardService,
    private readonly dialogService: DialogService,
    private readonly homographyService: HomographyService,
    private readonly floorplanService: FloorplanService,  // ← add this
  ) {}


  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('projectId') ?? '';

    interval(POLL_INTERVAL_MS).pipe(
      startWith(0),
      takeUntil(this.destroy$),
    ).subscribe(() => this.loadDevices());

    this.loadBoardLibrary();
    this.loadFloorplans();

    setTimeout(() => {
      if (!localStorage.getItem(this.TOUR_KEY)) {
        this.showTutorial = true;
      }
    }, 500);
  }

  startTour(): void {
    this.showTutorial = true;
  }

  onTutorialDone(): void {
    this.showTutorial = false;
    localStorage.setItem(this.TOUR_KEY, '1');
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadDevices(): void {
    this.deviceService.getDevices().subscribe({
      next: (all) => {
        this.devices = all.filter((d) => d.ProjectId === this.projectId);
        this.loading = false;
        this.checkLocalHomographies();
      },
      error: () => { this.loading = false; },
    });
  }

  private checkLocalHomographies(): void {
    if (this.devices.length === 0) {
      this.hasLocalHomographies = false;
      this.homographyCameraKeys.clear();
      this.puzzleReady = false;
      this.puzzlePiecesTotal = 0;
      this.puzzlePiecesReady = 0;
      return;
    }

    this.homographyService.getPuzzleWorkspace(this.projectId).subscribe({
      next: (workspace) => {
        this.puzzlePiecesTotal = workspace.PuzzlePieces.length;
        this.puzzlePiecesReady = workspace.PuzzlePieces.filter((p) => p.Status === 'ready').length;
        this.puzzleReady = this.puzzlePiecesTotal > 0 && this.puzzlePiecesTotal === this.puzzlePiecesReady;

        this.homographyCameraKeys = new Set(
          (workspace.LocalHomographies ?? [])
            .filter((h) => !!h.DeviceId && !!h.CameraMac)
            .map((h) => this.buildCameraKey(h.DeviceId, h.CameraMac)),
        );

        this.hasLocalHomographies =
          this.allCameras.length > 0 &&
          this.statHomographiesDone === this.allCameras.length;

        this.globalHomographies = workspace.GlobalHomographies ?? null;
      },
      error: () => {
        this.puzzleReady = false;
        this.puzzlePiecesTotal = 0;
        this.puzzlePiecesReady = 0;
        this.homographyCameraKeys.clear();
        this.hasLocalHomographies = false;
        this.globalHomographies = null;
      },
    });
  }

  private loadFloorplans(): void {
    this.floorplansLoading = true;
    this.floorplanService.getLibrary(this.projectId).subscribe({
      next: (items) => {
        this.floorplans = items;
        this.floorplansLoading = false;
        // Auto-select the first one if nothing is selected yet
        if (!this.selectedFloorplanId && items.length > 0) {
          this.selectedFloorplanId = items[0].Id;
        }
        // Clear selection if the selected floorplan was deleted
        if (this.selectedFloorplanId && !items.find((f) => f.Id === this.selectedFloorplanId)) {
          this.selectedFloorplanId = items[0]?.Id ?? null;
        }
      },
      error: () => { this.floorplansLoading = false; },
    });
  }

  selectFloorplan(id: string): void {
    this.selectedFloorplanId = id;
  }

  get selectedFloorplan(): FloorplanItem | null {
    return this.floorplans.find((f) => f.Id === this.selectedFloorplanId) ?? null;
  }

  get globalSavedAt(): string | null {
    if (!this.globalHomographies?.SavedAt) return null;
    const date = new Date(this.globalHomographies.SavedAt);
    if (Number.isNaN(date.getTime())) return null;
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  }


  onFloorplanFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    const nickname = file.name.replace(/\.[^.]+$/, ''); // strip extension for default name
    this.uploadingFloorplan = true;
    this.floorplanService.upload(file, nickname, this.projectId).subscribe({
      next: () => {
        this.uploadingFloorplan = false;
        this.loadFloorplans();
      },
      error: () => { this.uploadingFloorplan = false; },
    });
  }

  deleteFloorplan(id: string): void {
    this.floorplanService.delete(id).subscribe({
      next: () => this.loadFloorplans(),
    });
  }



  get allCameras(): CameraEntry[] {
    // Collect all (device, mac, info) tuples across all devices
    const allEntries: { device: DeviceDto; mac: string; info: CameraInfo }[] = [];
    for (const device of this.devices) {
      for (const [mac, info] of Object.entries(device.HealthReport?.Cameras ?? {})) {
        if (info) allEntries.push({ device, mac, info });
      }
    }

    // Deduplicate by MAC: prefer the device where the camera is Enabled
    const byMac = new Map<string, { device: DeviceDto; mac: string; info: CameraInfo }>();
    for (const entry of allEntries) {
      const existing = byMac.get(entry.mac);
      if (!existing || (!existing.info.Enabled && entry.info.Enabled)) {
        byMac.set(entry.mac, entry);
      }
    }

    let index = 0;
    return Array.from(byMac.values()).map(({ device, mac, info }) => {
      const intrinsicsMap = device.HealthReport?.IntrinsicsCalibration ?? {};
      return {
        device,
        mac,
        info,
        intrinsics: intrinsicsMap[mac] ?? null,
        nickname: localStorage.getItem(`cam-nickname-${mac}`) ?? '',
        index: ++index,
      };
    });
  }

  get statIntrinsicsDone(): number {
    return this.allCameras.filter((c) => c.intrinsics?.Status === 'done').length;
  }

  get firstCamera(): CameraEntry | null {
    return this.allCameras[0] ?? null;
  }

  get firstDevice(): DeviceDto | null {
    return this.devices[0] ?? null;
  }

  get firstCameraNeedingIntrinsics(): CameraEntry | null {
    return this.allCameras.find((c) => c.intrinsics?.Status !== 'done') ?? this.firstCamera;
  }

  get firstCameraReadyForHomography(): CameraEntry | null {
    return this.allCameras.find((c) => c.intrinsics?.Status === 'done') ?? null;
  }

  get statCamerasReady(): number {
    return this.allCameras.filter((c) => c.intrinsics?.Status === 'done').length;
  }

  get statArUcoLocked(): boolean {
    return this.devices.some((d) => this.getArucoStatus(d) === 'locked');
  }

  get statHomographiesDone(): number {
    return this.allCameras.filter((cam) => this.hasHomography(cam)).length;
  }

  get camsNeedingAttention(): number {
    return this.allCameras.filter((c) => c.intrinsics?.Status !== 'done').length;
  }

  get recommendedAction(): string | null {
    if (this.loading) return null;
    if (this.allCameras.length === 0) {
      return 'No cameras found. Ensure devices are online and reporting a health report.';
    }
    if (this.statIntrinsicsDone < this.allCameras.length) {
      const n = this.allCameras.length - this.statIntrinsicsDone;
      return `${n} camera${n > 1 ? 's' : ''} still need intrinsics calibration. Click a camera card to run calibration.`;
    }
    if (!this.statArUcoLocked) {
      return 'Intrinsics complete. Run ArUco lock calibration on each device to finalize setup.';
    }
    return null;
  }

  get homographyActionLabel(): string {
    if (this.firstCameraReadyForHomography) {
      return 'Open Camera';
    }

    return 'Needs Intrinsics';
  }

  get homographyHelpText(): string {
    if (this.firstCameraReadyForHomography) {
      return 'Use a camera with intrinsics complete to trigger the ChArUco homography scan.';
    }

    return 'Finish at least one camera intrinsics calibration before running homography.';
  }

  cameraStatusClass(cam: CameraEntry): string {
    if (cam.intrinsics?.Status === 'done') return 'border-green-500';
    if (cam.intrinsics?.Status === 'collecting') return 'border-yellow-500';
    return 'border-red-500';
  }

  intrinsicsSeverity(cam: CameraEntry): 'success' | 'info' | 'secondary' {
    if (cam.intrinsics?.Status === 'done') return 'success';
    if (cam.intrinsics?.Status === 'collecting') return 'info';
    return 'secondary';
  }

  homographySeverity(cam: CameraEntry): 'success' | 'secondary' {
    return this.hasHomography(cam) ? 'success' : 'secondary';
  }

  homographyTooltip(cam: CameraEntry): string {
    return this.hasHomography(cam) ? 'Homography ready' : 'Homography missing';
  }

  arucoSeverity(cam: CameraEntry): 'success' | 'warn' | 'danger' | 'secondary' {
    const status = this.getArucoStatus(cam.device);
    if (status === 'locked') return 'success';
    if (status === 'scanning') return 'warn';
    if (status === 'failed' || status === 'error') return 'danger';
    return 'secondary';
  }

  arucoTooltip(cam: CameraEntry): string {
    const status = this.getArucoStatus(cam.device);
    if (status === 'locked') return 'ArUco lock ready';
    if (status === 'scanning') return 'ArUco lock scanning';
    if (status === 'failed' || status === 'error') return 'ArUco lock failed';
    return 'ArUco lock unlocked';
  }

  isOnline(device: DeviceDto): boolean {
    return this.isHeartbeatFresh(device);
  }

  formatLastSeen(device: DeviceDto): string {
    const date = this.getHealthReportDate(device);
    if (!date) return 'Never';
    if (Number.isNaN(date.getTime())) return 'Unknown';
    const diffMs = Date.now() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  }

  camerasForDevice(device: DeviceDto): number {
    return Object.keys(device.HealthReport?.Cameras ?? {}).length;
  }

  private isHeartbeatFresh(device: DeviceDto): boolean {
    const date = this.getHealthReportDate(device);
    if (!date) return false;

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

  private getHealthReportDate(device: DeviceDto): Date | null {
    const ts = device.HealthReport?.Timestamp;
    if (!ts) return null;

    const ms = ts < 1_000_000_000_000 ? ts * 1000 : ts;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  private hasHomography(cam: CameraEntry): boolean {
    if (!cam.device?.Id) return false;
    return this.homographyCameraKeys.has(this.buildCameraKey(cam.device.Id, cam.mac));
  }

  private buildCameraKey(deviceId: string, mac: string): string {
    return `${deviceId.trim().toLowerCase()}|${mac.trim().toLowerCase()}`;
  }

  private getArucoStatus(device: DeviceDto): string {
    return (device.Config?.ArucoLock?.Status ?? 'unlocked').trim().toLowerCase();
  }

  openCameraModal(cam: CameraEntry): void {
    const label = cam.nickname || `Camera ${cam.index}`;
    const ref = this.dialogService.open(CameraModal, {
      header: label,
      width: '580px',
      modal: true,
      dismissableMask: true,
      closable: true,
      data: {
        device: cam.device,
        mac: cam.mac,
        camInfo: cam.info,
        intrinsics: cam.intrinsics,
        allDevices: this.devices,
        homographyReady: this.hasHomography(cam),
      },
    });
    this.camRef = ref;
    ref?.onClose.subscribe(() => this.loadDevices());
  }

  openDeviceModal(device: DeviceDto): void {
    const ref = this.dialogService.open(DeviceModal, {
      header: device.Name || 'Jetson Device',
      width: '560px',
      modal: true,
      dismissableMask: true,
      closable: true,
      data: { device, allDevices: this.devices },
    });
    this.deviceRef = ref;
    ref?.onClose.subscribe(() => this.loadDevices());
  }

  openBoardGenerateModal(): void {
    const ref = this.dialogService.open(BoardGenerateModal, {
      header: 'Generate New Board',
      width: '760px',
      modal: true,
      dismissableMask: true,
      closable: true,
      data: {},
    });
    if (!ref) return;

    this.boardGenRef = ref;

    ref.onClose.subscribe((result?: { saved?: boolean }) => {
      if (result?.saved) {
        this.loadBoardLibrary();
      }
    });
  }

  openHardwareSetup(): void {
    if (this.firstDevice) {
      this.openDeviceModal(this.firstDevice);
    }
  }

  openCameraDiscovery(): void {
    const target = this.firstCameraNeedingIntrinsics ?? this.firstCamera;
    if (target) {
      this.openCameraModal(target);
    }
  }

  openIntrinsicsCalibration(): void {
    if (this.firstCameraNeedingIntrinsics) {
      this.openCameraModal(this.firstCameraNeedingIntrinsics);
    }
  }

  openHomographyCalibration(): void {
    if (this.firstCameraReadyForHomography) {
      this.openCameraModal(this.firstCameraReadyForHomography);
    }
  }

  openArucoLock(): void {
    if (this.firstDevice) {
      this.openDeviceModal(this.firstDevice);
    }
  }

  openPuzzleWorkspace(): void {
    const floorplan = this.selectedFloorplan;
    void this.router.navigate([this.projectId, 'calibration', 'puzzle'], {
      queryParams: floorplan
        ? { floorplanUrl: floorplan.ImageDownloadUrl, floorplanId: floorplan.Id }
        : {},
    });
  }

  openBoardDetailModal(board: BoardLibraryItem): void {
    const ref = this.dialogService.open(BoardDetailModal, {
      header: board.Nickname || 'Board',
      width: '700px',
      modal: true,
      dismissableMask: true,
      closable: true,
      data: {
        board,
        onBoardUpdated: () => this.loadBoardLibrary(),
      },
    });
    if (!ref) {
      return;
    }

    this.boardDetailRef = ref;
    ref.onClose.subscribe((result?: { updated?: boolean; deleted?: boolean }) => {
      if (result?.updated || result?.deleted) {
        this.loadBoardLibrary();
      }
    });
  }

  boardPreviewUrl(svg: string): string {
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg ?? '')}`;
  }

  private loadBoardLibrary(): void {
    this.boardLibraryLoading = true;
    this.boardLibraryError = false;

    this.boardService.getLibrary().subscribe({
      next: (items) => {
        this.boardLibrary = items;
        this.boardLibraryLoading = false;
      },
      error: () => {
        this.boardLibrary = [];
        this.boardLibraryLoading = false;
        this.boardLibraryError = true;
      },
    });
  }
}
