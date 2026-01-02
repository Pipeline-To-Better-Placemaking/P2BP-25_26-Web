import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { DeviceDto } from '../../../../models/DeviceDto';
import { Config } from '../../../../models/jetson-dtos/Config';

@Component({
  selector: 'app-device-form',
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule, InputNumberModule, CheckboxModule],
  templateUrl: './device-form.html',
  styleUrl: './device-form.scss',
})
export class DeviceForm implements OnInit {
  form!: FormGroup;
  @Input() device: DeviceDto | null = null;
  @Output() deviceChange = new EventEmitter<DeviceDto>();
  private originalDevice: DeviceDto | null = null;

  constructor(
    private readonly fb: FormBuilder,
    private readonly ref: DynamicDialogRef,
    private readonly config: DynamicDialogConfig,
  ) {}

  ngOnInit(): void {
    const existing = this.device ?? (this.config.data as DeviceDto | undefined);
    this.originalDevice = existing ?? null;

    this.form = this.fb.group({
      Id: [existing?.Id ?? ''],
      Name: [existing?.Name ?? '', Validators.required],
      ProjectId: [existing?.ProjectId ?? ''],
      Config: this.createConfigGroup(existing?.Config),
    });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.value;
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
    });
  }

  private buildConfigValue(value: any): Config {
    const tracking = value?.Tracking ?? {};
    const camera = value?.Camera ?? {};

    return {
      // DeviceId is managed by the backend; preserve existing value if present.
      HeartbeatInterval: value?.HeartbeatInterval ?? 0,
      Version: this.cleanString(value?.Version),
      Tracking: {
        Enabled: !!tracking.Enabled,
        Model: this.cleanString(tracking.Model),
        ConfidenceThreshold: tracking.ConfidenceThreshold ?? 0,
        MaxFps: tracking.MaxFps ?? 0,
      },
      Camera: {
        Resolution: this.cleanString(camera.Resolution),
        Framerate: camera.Framerate ?? 0,
        Codec: this.cleanString(camera.Codec),
      },
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
