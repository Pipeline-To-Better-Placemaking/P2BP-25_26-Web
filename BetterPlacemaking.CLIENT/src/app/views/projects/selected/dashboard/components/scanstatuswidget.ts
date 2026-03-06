import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

@Component({
  standalone: true,
  selector: 'app-scan-status-widget',
  imports: [CommonModule, ButtonModule],
  template: `
    <div class="card shadow-sm">
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-xl font-semibold">Last Scan</h3>
        <p-button
          icon="pi pi-refresh"
          [text]="true"
          [rounded]="true"
          (onClick)="refresh.emit()">
        </p-button>
      </div>

      <div class="flex-grow flex flex-col items-center justify-center">
        <div class="text-center mb-6">
          <i class="pi pi-clock text-6xl text-blue-500 mb-4"></i>
          <div class="text-4xl font-bold mb-2">
            {{ formatTimeAgoFn(lastScanTime) }}
          </div>
          <div class="text-gray-600">
            Last device report received
          </div>
        </div>

        <div class="text-sm">
          {{ lastScanTime.toLocaleString() }}
        </div>
      </div>

      <div class="mt-6">
        <p-button
          label="Run Full Scan"
          icon="pi pi-search"
          styleClass="w-full">
        </p-button>
      </div>
    </div>
  `
})
export class ScanStatusWidget {
  @Input({ required: true }) lastScanTime!: Date;
  @Input({ required: true }) formatTimeAgoFn!: (date: Date) => string;
  @Output() refresh = new EventEmitter<void>();
}
