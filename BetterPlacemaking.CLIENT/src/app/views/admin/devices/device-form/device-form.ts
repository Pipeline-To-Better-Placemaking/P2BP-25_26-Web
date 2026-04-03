import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { PanelModule } from 'primeng/panel';
import { SelectModule } from 'primeng/select';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { DeviceDto } from '../../../../models/DeviceDto';
import { ProjectService } from '../../../../services/project-service';
import {
  ArucoLockConfig,
  CameraConfig,
  CharucoBoardConfig,
  CharucoBoardDetails,
  CharucoPoint,
  CharucoReferencePoints,
  Config,
  IntrinsicsConfig,
  TrackingCamerasConfig,
  TrackingConfig,
} from '../../../../models/jetson-dtos/Config';

type TrackingCameraRowValue = {
  Key: string | null;
  Enabled: boolean | null;
};

type CharucoPointValue = {
  X: number | null;
  Y: number | null;
};

type CharucoReferencePointsValue = {
  P1: CharucoPointValue;
  P2: CharucoPointValue;
};

type CharucoBoardDetailsValue = {
  SquaresX: number | null;
  SquaresY: number | null;
  SquareSize: number | null;
  ArucoSize: number | null;
  Dictionary: string | null;
};

type CharucoBoardValue = {
  BeginScanning: boolean | null;
  ReferencePoints: CharucoReferencePointsValue;
  Board: CharucoBoardDetailsValue;
};

type ArucoLockValue = {
  BeginScanning: boolean | null;
  ArucoDict: string | null;
  MinFrames: number | null;
  MaxSecondsPerCam: number | null;
};

type IntrinsicsValue = {
  BeginCalibration: boolean | null;
  ModelId: string | null;
  MinSightings: number | null;
  GridCells: number | null;
};

type ConfigValue = {
  HeartbeatInterval: number;
  Version: string | null;
  Tracking: TrackingConfig;
  Camera: CameraConfig;
  TrackingCameras: TrackingCameraRowValue[];
  CharucoBoard: CharucoBoardValue;
  ArucoLock: ArucoLockValue;
  Intrinsics: IntrinsicsValue;
};

type DeviceFormValue = {
  Id: string;
  Name: string;
  ProjectId: string;
  Config: ConfigValue;
};

@Component({
  selector: 'app-device-form',
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, InputTextModule, InputNumberModule, CheckboxModule, PanelModule, SelectModule],
  templateUrl: './device-form.html',
  styleUrl: './device-form.scss',
})
export class DeviceForm implements OnInit {
  form!: FormGroup;
  @Input() device: DeviceDto | null = null;
  @Output() deviceChange = new EventEmitter<DeviceDto>();
  private originalDevice: DeviceDto | null = null;

  projectOptions: { label: string; value: string }[] = [];

  constructor(
    private readonly fb: FormBuilder,
    private readonly ref: DynamicDialogRef,
    private readonly config: DynamicDialogConfig,
    private readonly projectService: ProjectService,
  ) {}

  ngOnInit(): void {
    const existing = this.device ?? (this.config.data as DeviceDto | undefined);
    this.originalDevice = existing ?? null;

    this.form = this.fb.group({
      Id: [existing?.Id ?? ''],
      Name: [existing?.Name ?? '', Validators.required],
      ProjectId: [existing?.ProjectId ?? null],
      Config: this.createConfigGroup(existing?.Config),
    });

    this.projectService.getProjects().subscribe({
      next: (projects) => {
        this.projectOptions = projects
          .filter(p => !!p.Id)
          .map(p => ({ label: p.Title || p.Id, value: p.Id }));
      },
    });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue() as DeviceFormValue;
    const device: DeviceDto = {
      ...this.originalDevice,
      Id: value.Id,
      Name: value.Name,
      ProjectId: value.ProjectId || undefined,
      Config: this.buildConfigValue(value.Config),
    };
    this.deviceChange.emit(device);
    this.ref.close(device);
  }

  onCancel(): void {
    this.ref.close();
  }

  get trackingCameras(): FormArray {
    return this.form.get(['Config', 'TrackingCameras']) as FormArray;
  }

  private createConfigGroup(config?: Config): FormGroup {
    return this.fb.group({
      HeartbeatInterval: [config?.HeartbeatInterval ?? 60, [Validators.required, Validators.min(1)]],
      Version: [config?.Version ?? ''],
      Tracking: this.fb.group({
        Enabled: [config?.Tracking?.Enabled ?? false],
        Model: [config?.Tracking?.Model ?? ''],
        ConfidenceThreshold: [config?.Tracking?.ConfidenceThreshold ?? 0.5, [Validators.min(0), Validators.max(1)]],
        MaxFps: [config?.Tracking?.MaxFps ?? 30, [Validators.min(0)]],
      }),
      Camera: this.fb.group({
        Resolution: [config?.Camera?.Resolution ?? ''],
        Framerate: [config?.Camera?.Framerate ?? 30, [Validators.min(0)]],
        Codec: [config?.Camera?.Codec ?? ''],
      }),
      TrackingCameras: this.createTrackingCamerasArray(config?.TrackingCameras ?? null),
      CharucoBoard: this.createCharucoBoardGroup(config?.CharucoBoard ?? null),
      ArucoLock: this.createArucoLockGroup(config?.ArucoLock ?? null),
      Intrinsics: this.createIntrinsicsGroup(config?.Intrinsics ?? null),
    });
  }

  private createTrackingCamerasArray(trackingCameras: Record<string, boolean> | null): FormArray {
    const groups = Object.entries(trackingCameras ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, enabled]) =>
        this.fb.group({
          Key: [{ value: key, disabled: true }],
          Enabled: [enabled],
        }),
      );

    return this.fb.array(groups);
  }

  private createCharucoBoardGroup(charuco: CharucoBoardConfig | null): FormGroup {
    return this.fb.group({
      BeginScanning: [charuco?.BeginScanning ?? false],
      ReferencePoints: this.fb.group({
        P1: this.fb.group({
          X: [charuco?.ReferencePoints?.P1?.X ?? null],
          Y: [charuco?.ReferencePoints?.P1?.Y ?? null],
        }),
        P2: this.fb.group({
          X: [charuco?.ReferencePoints?.P2?.X ?? null],
          Y: [charuco?.ReferencePoints?.P2?.Y ?? null],
        }),
      }),
      Board: this.fb.group({
        SquaresX: [charuco?.Board?.SquaresX ?? null, [Validators.min(0)]],
        SquaresY: [charuco?.Board?.SquaresY ?? null, [Validators.min(0)]],
        SquareSize: [charuco?.Board?.SquareSize ?? null, [Validators.min(0)]],
        ArucoSize: [charuco?.Board?.ArucoSize ?? null, [Validators.min(0)]],
        Dictionary: [charuco?.Board?.Dictionary ?? ''],
      }),
    });
  }

  private createArucoLockGroup(arucoLock: ArucoLockConfig | null): FormGroup {
    return this.fb.group({
      BeginScanning: [arucoLock?.BeginScanning ?? false],
      ArucoDict: [arucoLock?.ArucoDict ?? 'DICT_4X4_50'],
      MinFrames: [arucoLock?.MinFrames ?? 10, [Validators.min(1)]],
      MaxSecondsPerCam: [arucoLock?.MaxSecondsPerCam ?? 10, [Validators.min(1)]],
    });
  }

  private createIntrinsicsGroup(intrinsics: IntrinsicsConfig | null): FormGroup {
    return this.fb.group({
      BeginCalibration: [intrinsics?.BeginCalibration ?? false],
      ModelId: [intrinsics?.ModelId ?? ''],
      MinSightings: [intrinsics?.MinSightings ?? 40, [Validators.min(1)]],
      GridCells: [intrinsics?.GridCells ?? 9, [Validators.min(1)]],
    });
  }

  private buildConfigValue(value: ConfigValue): Config {
    const tracking = value.Tracking;
    const camera = value.Camera;
    const trackingCameras = this.buildTrackingCamerasValue(value.TrackingCameras);
    const charucoBoard = this.buildCharucoBoardValue(value.CharucoBoard);
    const arucoLock = this.buildArucoLockValue(value.ArucoLock);
    const intrinsics = this.buildIntrinsicsValue(value.Intrinsics);

    const shouldIncludeTrackingCameras =
      trackingCameras != null || (this.originalDevice?.Config?.TrackingCameras ?? null) != null;
    const shouldIncludeCharucoBoard =
      charucoBoard != null || (this.originalDevice?.Config?.CharucoBoard ?? null) != null;
    const shouldIncludeArucoLock =
      arucoLock != null || (this.originalDevice?.Config?.ArucoLock ?? null) != null;
    const shouldIncludeIntrinsics =
      intrinsics != null || (this.originalDevice?.Config?.Intrinsics ?? null) != null;

    return {
      HeartbeatInterval: value.HeartbeatInterval ?? 0,
      Version: this.cleanString(value.Version ?? null),
      Tracking: {
        Enabled: !!tracking.Enabled,
        Model: this.cleanString(tracking.Model ?? null),
        ConfidenceThreshold: tracking.ConfidenceThreshold ?? 0,
        MaxFps: tracking.MaxFps ?? 0,
      },
      Camera: {
        Resolution: this.cleanString(camera.Resolution ?? null),
        Framerate: camera.Framerate ?? 0,
        Codec: this.cleanString(camera.Codec ?? null),
      },
      TrackingCameras: shouldIncludeTrackingCameras ? trackingCameras : null,
      CharucoBoard: shouldIncludeCharucoBoard ? charucoBoard : null,
      ArucoLock: shouldIncludeArucoLock ? arucoLock : null,
      Intrinsics: shouldIncludeIntrinsics ? intrinsics : null,
    };
  }

  private buildTrackingCamerasValue(rows: TrackingCameraRowValue[]): TrackingCamerasConfig | null {
    if (!rows || rows.length === 0) {
      return null;
    }

    const result: TrackingCamerasConfig = {};
    for (const row of rows) {
      const key = this.cleanString(row.Key);
      if (!key) {
        continue;
      }
      result[key] = !!row.Enabled;
    }

    return Object.keys(result).length ? result : null;
  }

  private buildCharucoBoardValue(value: CharucoBoardValue): CharucoBoardConfig | null {
    if (!value) {
      return null;
    }

    const beginScanning = !!value.BeginScanning;
    const p1 = value.ReferencePoints?.P1;
    const p2 = value.ReferencePoints?.P2;
    const board = value.Board;

    const referencePoints = this.buildReferencePoints(p1, p2);
    const boardDetails = this.buildBoardDetails(board);

    if (!beginScanning && referencePoints == null && boardDetails == null) {
      return null;
    }

    return {
      BeginScanning: beginScanning,
      ReferencePoints: referencePoints,
      Board: boardDetails,
    };
  }

  private buildArucoLockValue(value: ArucoLockValue): ArucoLockConfig | null {
    if (!value) return null;
    return {
      BeginScanning: !!value.BeginScanning,
      ArucoDict: this.cleanString(value.ArucoDict) ?? 'DICT_4X4_50',
      MinFrames: value.MinFrames ?? 10,
      MaxSecondsPerCam: value.MaxSecondsPerCam ?? 10,
    };
  }

  private buildIntrinsicsValue(value: IntrinsicsValue): IntrinsicsConfig | null {
    if (!value) return null;
    return {
      BeginCalibration: !!value.BeginCalibration,
      ModelId: this.cleanString(value.ModelId),
      MinSightings: value.MinSightings ?? 40,
      GridCells: value.GridCells ?? 9,
    };
  }

  private buildReferencePoints(p1?: CharucoPointValue, p2?: CharucoPointValue): CharucoReferencePoints | null {
    const shouldInclude =
      p1?.X != null || p1?.Y != null ||
      p2?.X != null || p2?.Y != null;

    if (!shouldInclude) {
      return null;
    }

    const toPoint = (p?: CharucoPointValue): CharucoPoint | null => {
      if (!p || (p.X == null && p.Y == null)) {
        return null;
      }
      return {
        X: p.X ?? 0,
        Y: p.Y ?? 0,
      };
    };

    return {
      P1: toPoint(p1),
      P2: toPoint(p2),
    };
  }

  private buildBoardDetails(board: CharucoBoardDetailsValue): CharucoBoardDetails | null {
    const hasAny =
      board?.SquaresX != null ||
      board?.SquaresY != null ||
      board?.SquareSize != null ||
      board?.ArucoSize != null ||
      this.cleanString(board?.Dictionary ?? null) != null;

    if (!hasAny) {
      return null;
    }

    return {
      SquaresX: board.SquaresX ?? 0,
      SquaresY: board.SquaresY ?? 0,
      SquareSize: board.SquareSize ?? 0,
      ArucoSize: board.ArucoSize ?? 0,
      Dictionary: this.cleanString(board.Dictionary ?? null),
    };
  }

  private cleanString(value?: string | null): string | null {
    if (value == null) {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
}
