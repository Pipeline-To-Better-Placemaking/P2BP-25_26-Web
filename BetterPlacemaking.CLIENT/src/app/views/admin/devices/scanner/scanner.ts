import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Subscription, interval } from 'rxjs';

import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { DividerModule } from 'primeng/divider';

import { DeviceService } from '../../../../services/device-service';
import { DeviceDto } from '../../../../models/DeviceDto';
import {
  BASE_SCAN_SETTINGS,
  SCAN_PRESETS,
  ScanPreset,
  ScanRecordDto,
  ScanScheduleDto,
  ScanService,
  ScanSettingsPayload
} from '../../../../services/scan-service';
import { PointCloudViewerComponent } from '../../../../components/point-cloud-viewer/point-cloud-viewer.component';
import { SolidObjectsViewComponent } from '../../../../solid-objects/solid-objects-view.component';

export type ScannerVisualMode = '3d' | 'solids';

interface FrequencyOption {
  name: string;
  code: string;
}

interface SelectOption<T> {
  label: string;
  value: T;
}

@Component({
  selector: 'app-scanner',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    MessageModule,
    DatePickerModule,
    SelectModule,
    ToggleSwitchModule,
    DividerModule,
    PointCloudViewerComponent,
    SolidObjectsViewComponent,
  ],
  templateUrl: './scanner.html',
  styleUrls: ['./scanner.scss']
})
export class Scanner implements OnInit, OnDestroy {
  public projectId = '';
  public visualMode: ScannerVisualMode = 'solids';

  public scanMessage: string | null = null;
  public scanMessageSeverity: 'success' | 'info' | 'warn' | 'error' = 'info';
  public scanning = false;
  public scheduleMessage: string | null = null;

  public scheduledDateTime: Date | null = null;
  public endDateTime: Date | null = null;

  public frequencyOptions: FrequencyOption[] = [
    { name: 'Never', code: 'Never' },
    { name: 'Weekly', code: 'Weekly' },
    { name: 'Monthly', code: 'Monthly' },
    { name: 'Yearly', code: 'Yearly' }
  ];

  public selectedFrequency: FrequencyOption | undefined;
  public schedules: ScanScheduleDto[] = [];
  public editingScheduleId: string | null = null;
  public minEndDate: Date | null = null;

  public readonly baseScanSettings: ScanSettingsPayload = structuredClone(BASE_SCAN_SETTINGS);
  public scanSettings: ScanSettingsPayload = structuredClone(BASE_SCAN_SETTINGS);
  public selectedPreset: ScanPreset | null = 'base';

  public presetOptions: SelectOption<ScanPreset>[] = [
    { label: 'Base Quality', value: 'base' },
    { label: 'Medium Quality', value: 'medium' },
    { label: 'High Quality', value: 'high' }
  ];

  public scanResolutionOptions: SelectOption<ScanSettingsPayload['scan_resolution']>[] = [
    { label: '1 — 1.0° per slice', value: 1 },
    { label: '8 — 0.125° per slice', value: 8 },
    { label: '16 — 0.0625° per slice', value: 16 },
    { label: '32 — 0.03125° per slice', value: 32 },
    { label: '64 — 0.0156° per slice', value: 64 }
  ];

  public protocolModeOptions: SelectOption<ScanSettingsPayload['protocol_mode']>[] = [
    { label: 'Legacy', value: 'legacy' },
    { label: 'Express', value: 'express' },
    { label: 'Dense', value: 'dense' },
    { label: 'Ultra', value: 'ultra' }
  ];

  public orientationModeOptions: SelectOption<ScanSettingsPayload['orientation_mode']>[] = [
    { label: 'Table (Right Side Up)', value: 'table' },
    { label: 'Ceiling (Upside Down Up)', value: 'ceiling' },
    { label: 'Wall', value: 'wall' },
    { label: 'Custom', value: 'custom' }
  ];

  public outputModeOptions: SelectOption<ScanSettingsPayload['output_mode']>[] = [
    { label: 'Filtered Only', value: 'filtered_only' },
    { label: 'Raw Only', value: 'raw_only' },
    { label: 'Raw and Filtered', value: 'raw_and_filtered' }
  ];

  public splitModeOptions: SelectOption<ScanSettingsPayload['split_mode']>[] = [
    { label: 'None', value: 'none' },
    { label: 'Front / Back 180°', value: 'front_back_180' }
  ];

  public captureStrategyOptions: SelectOption<ScanSettingsPayload['capture_strategy']>[] = [
    { label: 'Fixed Time', value: 'fixed_time' },
    { label: 'Minimum Revolutions', value: 'min_revolutions' },
    { label: 'Hybrid', value: 'hybrid' }
  ];

  public minRevolutionOptions: SelectOption<ScanSettingsPayload['min_revolutions_per_slice']>[] = [
    { label: '1 revolution', value: 1 },
    { label: '2 revolutions', value: 2 },
    { label: '3 revolutions', value: 3 }
  ];

  public currentScanStatus: string | null = null;
  public currentScanRecord: ScanRecordDto | null = null;
  public scanHistory: ScanRecordDto[] = [];

  private currentLidarDeviceId: string | null = null;
  private scanStatusPollSub: Subscription | null = null;

  constructor(
    private route: ActivatedRoute,
    private deviceService: DeviceService,
    private scanService: ScanService
  ) {}

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('projectId') ?? '';
    if (this.projectId) {
      this.loadSchedules();
      this.resolveLidarDeviceAndLoadHistory();
    }
  }

  ngOnDestroy(): void {
    this.stopScanStatusPolling();
  }

  public setVisualMode(mode: ScannerVisualMode): void {
    this.visualMode = mode;
  }

  public applyPreset(preset: ScanPreset | null): void {
    if (!preset) {
      return;
    }

    this.selectedPreset = preset;
    this.scanSettings = structuredClone(SCAN_PRESETS[preset]);
  }

  public resetToBaseSettings(): void {
    this.selectedPreset = 'base';
    this.scanSettings = structuredClone(BASE_SCAN_SETTINGS);
  }

  public onScanSettingChanged(): void {
    this.selectedPreset = null;
  }

  public get helperOrientationCustomMessage(): string {
    return this.scanSettings.orientation_mode === 'custom'
      ? 'Custom orientation is selectable, but extra axis controls may still depend on backend support.'
      : '';
  }

  public performScan(): void {
    if (!this.projectId) {
      this.scanMessage = 'No project selected.';
      this.scanMessageSeverity = 'error';
      return;
    }

    this.scanning = true;
    this.scanMessage = null;
    this.scanMessageSeverity = 'info';

    const payload: ScanSettingsPayload = {
      ...this.scanSettings
    };

    this.deviceService.getDevices().subscribe({
      next: (devices: DeviceDto[]) => {
        const projectDevices = devices.filter(
          d => d.ProjectId === this.projectId && d.Name?.toLowerCase().includes('lidar')
        );

        if (projectDevices.length === 0) {
          this.scanMessage = 'No lidar device assigned to this project.';
          this.scanMessageSeverity = 'error';
          this.scanning = false;
          return;
        }

        const lidarDevice = projectDevices[0];

        if (!this.isLidarConnected(lidarDevice)) {
          this.scanMessage = 'LiDAR is not connected.';
          this.scanMessageSeverity = 'error';
          this.scanning = false;
          return;
        }

        this.currentLidarDeviceId = lidarDevice.Id;
        this.currentScanStatus = 'pending';
        this.currentScanRecord = {
          Status: 'pending'
        };

        this.scanService.startScan(this.projectId, lidarDevice.Id, payload).subscribe({
          next: () => {
            this.scanMessage = 'Scan requested successfully.';
            this.scanMessageSeverity = 'success';
            this.scanning = false;
            this.startScanStatusPolling(lidarDevice.Id);
            this.loadScanHistory(lidarDevice.Id);

            setTimeout(() => {
              this.scanMessage = null;
              this.scanMessageSeverity = 'info';
            }, 5000);
          },
          error: (err) => {
            this.scanMessage = this.getScanStartErrorMessage(err);
            this.scanMessageSeverity = 'error';
            this.scanning = false;
          }
        });
      },
      error: () => {
        this.scanMessage = 'Failed to load devices.';
        this.scanMessageSeverity = 'error';
        this.scanning = false;
      }
    });
  }

  public isLidarConnected(device: DeviceDto): boolean {
    const lidars = device?.HealthReport?.Lidars;
    if (!lidars) return false;

    const first = Object.values(lidars)[0];
    return first?.Connected === true;
  }

  public getScanStatusLabel(status: string | null): string {
    switch ((status ?? '').toLowerCase()) {
      case 'pending':
        return 'Queued';
      case 'calibrating':
        return 'Calibrating';
      case 'running':
      case 'in_progress':
        return 'Scan in progress';
      case 'complete':
      case 'done':
        return 'Done';
      case 'error':
      case 'failed':
        return 'Failed';
      default:
        return status ?? 'Unknown';
    }
  }

  public getScanStatusSeverity(status: string | null): 'success' | 'info' | 'warn' | 'error' {
    switch ((status ?? '').toLowerCase()) {
      case 'pending':
      case 'calibrating':
        return 'warn';
      case 'running':
      case 'in_progress':
        return 'info';
      case 'complete':
      case 'done':
        return 'success';
      case 'error':
      case 'failed':
        return 'error';
      default:
        return 'info';
    }
  }

  private resolveLidarDeviceAndLoadHistory(): void {
    this.deviceService.getDevices().subscribe({
      next: (devices: DeviceDto[]) => {
        const lidarDevice = devices.find(
          d => d.ProjectId === this.projectId && d.Name?.toLowerCase().includes('lidar')
        );

        if (!lidarDevice) {
          return;
        }

        this.currentLidarDeviceId = lidarDevice.Id;
        this.loadScanHistory(lidarDevice.Id);
      },
      error: () => {}
    });
  }

  private startScanStatusPolling(deviceId: string): void {
    this.stopScanStatusPolling();

    this.scanStatusPollSub = interval(3000).subscribe(() => {
      this.scanService.getScans(this.projectId, deviceId).subscribe({
        next: (scans: ScanRecordDto[]): void => {
          if (!scans?.length) {
            return;
          }

          const latest = this.getLatestScan(scans);
          this.scanHistory = [...scans];

          let status = (latest?.Status ?? '').toLowerCase();

          if ((status === 'complete' || status === 'done') && !latest?.ObjUrl) {
            status = 'failed';
            this.currentScanRecord = {
              ...latest,
              Status: 'failed',
              Error: latest?.Error ?? 'LiDAR did not produce scan data'
            };
          } else {
            this.currentScanRecord = latest;
          }

          this.currentScanStatus = status;

          const terminalStatuses = ['complete', 'done', 'error', 'failed'];
          if (terminalStatuses.includes(status)) {
            this.stopScanStatusPolling();
          }
        },
        error: () => {}
      });
    });
  }

  private stopScanStatusPolling(): void {
    this.scanStatusPollSub?.unsubscribe();
    this.scanStatusPollSub = null;
  }

  private loadScanHistory(deviceId: string): void {
    this.scanService.getScans(this.projectId, deviceId).subscribe({
      next: (scans: ScanRecordDto[]) => {
        this.scanHistory = [...(scans ?? [])];
      },
      error: () => {
        this.scanHistory = [];
      }
    });
  }

  private getLatestScan(scans: ScanRecordDto[]): ScanRecordDto {
    return [...scans].sort((a, b) => {
      const aTime = this.getSortTimestamp(a);
      const bTime = this.getSortTimestamp(b);
      return bTime - aTime;
    })[0];
  }

  private getSortTimestamp(scan: ScanRecordDto): number {
    const raw = scan?.CreatedAt ?? scan?.StartedAt ?? scan?.FinishedAt;
    if (!raw) {
      return 0;
    }

    if (typeof raw === 'string') {
      const parsed = Date.parse(raw);
      return Number.isNaN(parsed) ? 0 : parsed;
    }

    if ((raw as any)?.seconds) {
      return (raw as any).seconds * 1000;
    }

    return 0;
  }

  public formatScanDateTime(value: any): string {
    if (!value) {
      return '-';
    }

    if (typeof value === 'string') {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
    }

    if (value?.seconds) {
      return new Date(value.seconds * 1000).toLocaleString();
    }

    return '-';
  }

  private loadSchedules(): void {
    this.scanService.getSchedules(this.projectId).subscribe({
      next: (schedules) => {
        this.schedules = schedules;
      },
      error: () => {
        console.error('Failed to load scan schedules');
      },
    });
  }

  public scheduleScan(): void {
    if (!this.selectedFrequency) {
      this.scheduleMessage = 'Please select a frequency.';
      return;
    }

    if (!this.scheduledDateTime) {
      this.scheduleMessage = 'Please select a start date and time.';
      return;
    }

    if (this.selectedFrequency.code !== 'Never') {
      if (!this.endDateTime) {
        this.scheduleMessage = 'Please select an end date and time for recurring scans.';
        return;
      }

      if (this.endDateTime <= this.scheduledDateTime) {
        this.scheduleMessage = 'End date and time must be after start.';
        return;
      }
    }

    const payload: ScanScheduleDto = {
      StartDate: this.formatDate(this.scheduledDateTime),
      StartTime: this.formatTime(this.scheduledDateTime),
      Frequency: this.selectedFrequency.code,
      EndDate: this.endDateTime ? this.formatDate(this.endDateTime) : undefined,
      EndTime: this.endDateTime ? this.formatTime(this.endDateTime) : undefined,
    };

    if (this.editingScheduleId) {
      this.scanService.updateSchedule(this.projectId, this.editingScheduleId, payload).subscribe({
        next: () => {
          this.scheduleMessage = 'Schedule updated.';
          this.editingScheduleId = null;
          this.clearForm();
          this.loadSchedules();
          setTimeout(() => {
            this.scheduleMessage = null;
          }, 3000);
        },
        error: () => {
          this.scheduleMessage = 'Failed to update schedule.';
        },
      });
    } else {
      this.scanService.createSchedule(this.projectId, payload).subscribe({
        next: () => {
          this.scheduleMessage = 'Scan scheduled successfully!';
          this.clearForm();
          this.loadSchedules();
          setTimeout(() => {
            this.scheduleMessage = null;
          }, 3000);
        },
        error: () => {
          this.scheduleMessage = 'Failed to save schedule.';
        },
      });
    }
  }

  public cancelSchedule(id: string): void {
    this.scanService.deleteSchedule(this.projectId, id).subscribe({
      next: () => {
        this.loadSchedules();
      },
      error: () => {
        this.scheduleMessage = 'Failed to delete schedule.';
      },
    });
  }

  public editSchedule(schedule: ScanScheduleDto): void {
    this.scheduledDateTime = this.combineDateAndTime(schedule.StartDate, schedule.StartTime);
    this.endDateTime = schedule.EndDate && schedule.EndTime
      ? this.combineDateAndTime(schedule.EndDate, schedule.EndTime)
      : null;

    this.selectedFrequency = this.frequencyOptions.find(f => f.code === schedule.Frequency);
    this.editingScheduleId = schedule.Id ?? null;
    this.minEndDate = this.scheduledDateTime;
  }

  public onStartDateTimeChange(): void {
    this.minEndDate = this.scheduledDateTime;

    if (this.scheduledDateTime && this.endDateTime && this.endDateTime <= this.scheduledDateTime) {
      this.endDateTime = null;
    }
  }

  private clearForm(): void {
    this.scheduledDateTime = null;
    this.endDateTime = null;
    this.selectedFrequency = undefined;
    this.editingScheduleId = null;
    this.minEndDate = null;
  }

  public getScheduleFrequencyName(code: string): string {
    const freq = this.frequencyOptions.find(f => f.code === code);
    return freq ? freq.name : code;
  }

  private formatDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatTime(value: Date): string {
    const hours = String(value.getHours()).padStart(2, '0');
    const minutes = String(value.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private combineDateAndTime(dateStr: string, timeStr: string): Date {
    return new Date(`${dateStr}T${timeStr}`);
  }

  private getScanStartErrorMessage(err: any): string {
    if (err?.status === 409) {
      const message = err?.error?.message;
      if (typeof message === 'string' && message.trim()) {
        return message.trim();
      }
      return 'A scan is already in progress for this device.';
    }

    return 'Failed to start scan.';
  }
}
