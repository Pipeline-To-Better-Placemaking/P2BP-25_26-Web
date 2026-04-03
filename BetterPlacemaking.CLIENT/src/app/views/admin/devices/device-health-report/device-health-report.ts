import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { PanelModule } from 'primeng/panel';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { DeviceDto } from '../../../../models/DeviceDto';
import { HealthReport, IntrinsicsCalibrationState } from '../../../../models/jetson-dtos/HealthReport';

type ServiceRow = {
  Name: string;
  Active: string;
  Sub: string;
};

type CameraRow = {
  Key: string;
  Mac: string;
  Ip: string;
  Resolution: string;
  Enabled: boolean;
};

type DiskRow = {
  Path: string;
  UsedMb: number;
  TotalMb: number;
  FreeMb: number;
  UsePct: number;
  Status: string;
  DeletedFiles: number;
};

type IntrinsicsRow = {
  Mac: string;
  Status: string;
  SightingsCollected: number;
  CoverageFilled: number;
  CoverageTotal: number;
  CurrentRmse: number;
  SuggestedRegion: string;
  SuggestedTilt: string;
};

@Component({
  selector: 'app-device-health-report',
  imports: [CommonModule, PanelModule, TableModule, TagModule],
  templateUrl: './device-health-report.html',
  styleUrl: './device-health-report.scss',
})
export class DeviceHealthReport implements OnInit {
  device: DeviceDto | null = null;
  healthReport: HealthReport | null = null;

  serviceRows: ServiceRow[] = [];
  cameraRows: CameraRow[] = [];
  diskRows: DiskRow[] = [];
  intrinsicsRows: IntrinsicsRow[] = [];

  constructor(
    private readonly ref: DynamicDialogRef,
    private readonly config: DynamicDialogConfig,
  ) {}

  ngOnInit(): void {
    const data = (this.config.data ?? {}) as { device?: DeviceDto };
    this.device = data.device ?? null;
    this.healthReport = this.device?.HealthReport ?? null;

    this.serviceRows = Object.entries(this.healthReport?.Services ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, status]) => ({
        Name: name,
        Active: status?.Active ?? '',
        Sub: status?.Sub ?? '',
      }));

    this.cameraRows = Object.entries(this.healthReport?.Cameras ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, cam]) => {
        const res = cam?.Resolution ?? null;
        const resolution = Array.isArray(res) && res.length >= 2 ? `${res[0]} x ${res[1]}` : '';
        return {
          Key: key,
          Mac: cam?.Mac ?? '',
          Ip: cam?.Ip ?? '',
          Resolution: resolution,
          Enabled: !!cam?.Enabled,
        };
      });

    this.diskRows = (this.healthReport?.System?.Disk ?? []).map(d => ({
      Path: d.Path,
      UsedMb: d.UsedMb,
      TotalMb: d.TotalMb,
      FreeMb: d.FreeMb,
      UsePct: d.UsePct,
      Status: d.Status,
      DeletedFiles: d.DeletedFiles,
    }));

    this.intrinsicsRows = Object.entries(this.healthReport?.IntrinsicsCalibration ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mac, state]: [string, IntrinsicsCalibrationState]) => ({
        Mac: mac,
        Status: state.Status,
        SightingsCollected: state.SightingsCollected,
        CoverageFilled: (state.CoverageGrid ?? []).filter(v => !!v).length,
        CoverageTotal: (state.CoverageGrid ?? []).length,
        CurrentRmse: state.CurrentRmse,
        SuggestedRegion: state.SuggestedRegion ?? '—',
        SuggestedTilt: state.SuggestedTilt ?? '—',
      }));
  }

  close(): void {
    this.ref.close();
  }

  diskSeverity(status: string): 'success' | 'warn' | 'danger' | 'secondary' {
    if (status === 'ok') return 'success';
    if (status === 'warning') return 'warn';
    if (status === 'critical') return 'danger';
    return 'secondary';
  }

  intrinsicsSeverity(status: string): 'success' | 'info' | 'secondary' {
    if (status === 'done') return 'success';
    if (status === 'collecting') return 'info';
    return 'secondary';
  }

  get timestampText(): string {
    const ts = this.healthReport?.Timestamp;
    if (ts == null) {
      return '';
    }

    const ms = ts < 1_000_000_000_000 ? ts * 1000 : ts;
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) {
      return `${ts}`;
    }
    return `${date.toLocaleString()}`;
  }
}
