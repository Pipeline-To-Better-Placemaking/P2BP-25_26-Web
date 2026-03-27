import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

@Component({
  standalone: true,
  selector: 'app-scan-status-widget',
  imports: [CommonModule, ButtonModule],
  template: `
    <div class="card bg-surface-0 dark:bg-surface-900 shadow-sm rounded-xl border border-surface-300 dark:border-surface-700 p-6 bg-black">

      <div class="flex items-center justify-between mb-6">
        <button
          type="button"
          class="text-xl font-semibold text-left hover:underline"
          (click)="openModelPage.emit()">
          Last Scan
        </button>

        <p-button
          icon="pi pi-refresh"
          [text]="true"
          [rounded]="true"
          (onClick)="refresh.emit()">
        </p-button>
      </div>

      <div
        class="flex-grow flex flex-col items-center justify-center cursor-pointer"
        (click)="openModelPage.emit()">
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
  @Output() openModelPage = new EventEmitter<void>();
}