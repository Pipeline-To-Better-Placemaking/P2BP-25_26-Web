import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DeviceDto } from '../../../../../models/DeviceDto';

@Component({
  standalone: true,
  selector: 'app-devices-widget',
  imports: [CommonModule, ButtonModule],
  template: `
    <div class="card bg-surface-0 dark:bg-surface-900 shadow-sm rounded-xl border border-surface-300 dark:border-surface-700 p-6 bg-black">

    <div class="flex items-center justify-between mb-6">
        <div>
          <h3 class="text-xl font-semibold">Device Status</h3>
          <div class="text-xs text-gray-500 mt-1">
            Showing all devices temporarily until devices are assigned under projects.
          </div>
        </div>

        <p-button
          icon="pi pi-refresh"
          [text]="true"
          [rounded]="true"
          (onClick)="refresh.emit()">
        </p-button>
      </div>

      <div *ngIf="loading" class="text-sm text-gray-500">
        Loading devices...
      </div>

      <div *ngIf="error" class="text-sm text-red-500">
        {{ error }}
      </div>

      <div *ngIf="!loading && !error && devices.length === 0" class="text-sm text-gray-500">
        No devices are assigned yet.
      </div>

      <div class="space-y-3 max-h-96 overflow-y-auto pr-2" *ngIf="devices.length > 0">
        <div
          *ngFor="let device of devices"
          class="flex items-center justify-between p-2 border-b border-surface-200 dark:border-surface-700">

          <div class="flex items-center">
            <span
              [class]="'w-3 h-3 rounded-full mr-3 ' + getStatusColor(deviceStatusFn(device))">
            </span>

            <div>
              <div class="font-medium">{{ device.Name }}</div>
              <div class="text-sm text-muted-color">
                Resolution: {{ device.Config?.Camera?.Resolution ?? 'N/A' }}
              </div>
              <div class="text-sm text-muted-color">
                Version: {{ device.Config?.Version ?? 'Unknown' }}
              </div>
            </div>
          </div>

          <div class="text-sm text-muted-color">
            Last seen: {{ deviceLastSeenFn(device) }}
          </div>
        </div>
      </div>
    </div>
  `
})
export class DevicesWidget {
  @Input({ required: true }) devices!: DeviceDto[];
  @Input({ required: true }) loading!: boolean;
  @Input({ required: true }) error!: string | null;
  @Input({ required: true }) deviceStatusFn!: (device: DeviceDto) => 'online' | 'offline' | 'warning';
  @Input({ required: true }) deviceLastSeenFn!: (device: DeviceDto) => string;
  @Output() refresh = new EventEmitter<void>();

  getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      online: 'bg-green-500',
      offline: 'bg-red-500',
      warning: 'bg-yellow-500'
    };

    return colors[status] || 'bg-gray-400';
  }
}
