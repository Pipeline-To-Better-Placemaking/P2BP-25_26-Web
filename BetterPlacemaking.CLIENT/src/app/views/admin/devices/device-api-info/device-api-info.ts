import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { DeviceService } from '../../../../services/device-service';

@Component({
  selector: 'app-device-api-info',
  imports: [CommonModule, ButtonModule, InputTextModule],
  templateUrl: './device-api-info.html',
  styleUrl: './device-api-info.scss',
})
export class DeviceApiInfo {
  public deviceId: string | null = null;
  public apiKey: string | null = null;
  public isLoading = false;
  public copied = false;
  public error: string | null = null;

  public constructor(
    private readonly deviceService: DeviceService,
    private readonly ref: DynamicDialogRef,
    private readonly config: DynamicDialogConfig
  ) {
    this.deviceId = (this.config.data as { deviceId?: string } | undefined)?.deviceId ?? null;
  }

  public generateApiKey(): void {
    if (!this.deviceId || this.isLoading) {
      return;
    }

    this.isLoading = true;
    this.error = null;
    this.apiKey = null;
    this.copied = false;

    this.deviceService.getApiKey(this.deviceId).subscribe({
      next: (key) => {
        this.apiKey = key;
        this.isLoading = false;
      },
      error: () => {
        this.error = 'Failed to generate API key. Please try again.';
        this.isLoading = false;
      },
    });
  }

  public copyApiKey(): void {
    if (!this.apiKey) {
      return;
    }

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(this.apiKey)
        .then(() => {
          this.copied = true;
          setTimeout(() => (this.copied = false), 2000);
        })
        .catch(() => {
          this.copied = false;
        });
    }
  }

  public close(): void {
    this.ref.close();
  }
}
