import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { PanelModule } from 'primeng/panel';
import { InputNumberModule } from 'primeng/inputnumber';
import { ToggleButtonModule } from 'primeng/togglebutton';
import { TooltipModule } from 'primeng/tooltip';
import { SelectModule } from 'primeng/select';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { forkJoin } from 'rxjs';
import { DeviceService } from '../../../../../services/device-service';
import { DeviceDto } from '../../../../../models/DeviceDto';
import { ServiceStatus, SystemInfo } from '../../../../../models/jetson-dtos/HealthReport';
import { BoardService } from '../../../../../services/board-service';
import { BoardLibraryItem } from '../../../../../models/BoardLibrary';
import { PermissionDirective } from '../../../../../directives/permission.directive';

interface ServiceRow {
  name: string;
  active: string;
  sub: string;
}

@Component({
  selector: 'app-device-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    TagModule,
    MessageModule,
    PanelModule,
    InputNumberModule,
    ToggleButtonModule,
    TooltipModule,
    SelectModule,
    PermissionDirective,
  ],
  templateUrl: './device-modal.html',
})
export class DeviceModal implements OnInit {
  device: DeviceDto | null = null;
  allDevices: DeviceDto[] = [];

  // Quick settings edit state
  trackingEnabled = false;
  heartbeatInterval = 30;
  settingsSaved = false;
  settingsError = false;
  settingsLoading = false;

  // ArUco lock scan state
  boardLibrary: BoardLibraryItem[] = [];
  selectedArucoBoard: BoardLibraryItem | null = null;
  arucoScanLoading = false;
  arucoScanTriggered = false;
  arucoScanError = false;

  constructor(
    private readonly config: DynamicDialogConfig,
    private readonly ref: DynamicDialogRef,
    private readonly deviceService: DeviceService,
    private readonly boardService: BoardService,
  ) {}

  ngOnInit(): void {
    const data = (this.config.data ?? {}) as { device?: DeviceDto; allDevices?: DeviceDto[] };
    this.device = data.device ?? null;
    this.allDevices = data.allDevices ?? (this.device ? [this.device] : []);
    this.trackingEnabled = this.device?.Config?.Tracking?.Enabled ?? false;
    this.heartbeatInterval = this.device?.Config?.HeartbeatInterval ?? 30;

    this.boardService.getLibrary().subscribe({
      next: (items) => { this.boardLibrary = items; },
      error: () => { this.boardLibrary = []; },
    });
  }

  get arucoBoards(): BoardLibraryItem[] {
    return this.boardLibrary.filter((b) => b.Type === 'aruco');
  }

  get canScanAruco(): boolean {
    return !!this.selectedArucoBoard && !this.arucoScanLoading;
  }

  get system(): SystemInfo | null {
    return this.device?.HealthReport?.System ?? null;
  }

  get gpuPct(): number | null {
    return this.system?.Gpu?.UtilizationPct ?? null;
  }

  get gpuTempC(): number | null {
    const v = this.system?.Gpu?.TemperatureC ?? -1;
    return v >= 0 ? v : null;
  }

  get cpuTempC(): number | null {
    const v = this.system?.CpuTemperatureC ?? -1;
    return v >= 0 ? v : null;
  }

  get memUsedMb(): number | null {
    return this.system?.Memory?.UsedMb ?? null;
  }

  get memTotalMb(): number | null {
    return this.system?.Memory?.TotalMb ?? null;
  }

  get cameraCount(): number {
    return Object.keys(this.device?.HealthReport?.Cameras ?? {}).length;
  }

  get enabledCameraCount(): number {
    return Object.values(this.device?.HealthReport?.Cameras ?? {}).filter((c) => c?.Enabled).length;
  }

  get arucoStatus(): string {
    return this.device?.Config?.ArucoLock?.Status ?? 'unlocked';
  }

  get arucoSeverity(): 'success' | 'warn' | 'secondary' {
    if (this.arucoStatus === 'locked') return 'success';
    if (this.arucoStatus === 'scanning') return 'warn';
    return 'secondary';
  }

  get serviceRows(): ServiceRow[] {
    return Object.entries(this.device?.HealthReport?.Services ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, status]: [string, ServiceStatus]) => ({
        name,
        active: status?.Active ?? '—',
        sub: status?.Sub ?? '—',
      }));
  }

  get hasDegradedService(): boolean {
    return this.serviceRows.some(
      (s) => s.active !== 'active' && s.active !== 'activating' && s.active !== '—',
    );
  }

  get degradedServiceCount(): number {
    return this.serviceRows.filter(
      (s) => s.active !== 'active' && s.active !== 'activating' && s.active !== '—',
    ).length;
  }

  serviceSeverity(svc: ServiceRow): 'success' | 'warn' | 'danger' | 'secondary' {
    const state = svc.active.toLowerCase();
    if (state === 'active' || state === 'activating') return 'success';
    if (state === 'inactive') return 'secondary';
    if (state === 'failed' || state === 'dead') return 'danger';
    return 'warn';
  }

  saveSettings(): void {
    if (!this.device?.Id || !this.device.Config) return;
    this.settingsLoading = true;
    this.settingsSaved = false;
    this.settingsError = false;

    const updated: DeviceDto = {
      ...this.device,
      Config: {
        ...this.device.Config,
        HeartbeatInterval: this.heartbeatInterval,
        Tracking: this.device.Config.Tracking
          ? { ...this.device.Config.Tracking, Enabled: this.trackingEnabled }
          : { Enabled: this.trackingEnabled, ConfidenceThreshold: 0.5, MaxFps: 10 },
      },
    };

    this.deviceService.updateDevice(this.device.Id, updated).subscribe({
      next: (saved) => {
        this.device = saved;
        this.settingsSaved = true;
        this.settingsLoading = false;
      },
      error: () => {
        this.settingsError = true;
        this.settingsLoading = false;
      },
    });
  }

  triggerArucoScan(): void {
    if (!this.selectedArucoBoard || this.arucoScanLoading) return;
    this.arucoScanLoading = true;
    this.arucoScanError = false;

    const dict = this.selectedArucoBoard.Dictionary;

    const updates = this.allDevices
      .filter((d) => d.Id && d.Config)
      .map((d) =>
        this.deviceService.updateDevice(d.Id, {
          ...d,
          Config: {
            ...d.Config!,
            ArucoLock: {
              ...d.Config!.ArucoLock,
              BeginScanning: true,
              ArucoDict: dict,
            },
          },
        }),
      );

    if (updates.length === 0) {
      this.arucoScanLoading = false;
      return;
    }

    forkJoin(updates).subscribe({
      next: () => {
        this.arucoScanTriggered = true;
        this.arucoScanLoading = false;
      },
      error: () => {
        this.arucoScanError = true;
        this.arucoScanLoading = false;
      },
    });
  }
}
