import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { BadgeModule } from 'primeng/badge';

interface Alert {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
}

@Component({
  standalone: true,
  selector: 'app-alerts-widget',
  imports: [CommonModule, ButtonModule, BadgeModule],
  template: `
    <div class="card bg-surface-0 dark:bg-surface-900 shadow-sm rounded-xl border border-surface-300 dark:border-surface-700 p-6 bg-black"
      (click)="openDevicesPage.emit()">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <button
            type="button"
            class="text-xl font-semibold text-left hover:underline"
            (click)="openDevicesPage.emit()">
            Alerts
          </button>

          <p-button
            icon="pi pi-refresh"
            [text]="true"
            [rounded]="true"
            (onClick)="refresh.emit()">
          </p-button>
        </div>

        <button
          type="button"
          class="flex items-center space-x-2 hover:opacity-80 transition"
          (click)="openDevicesPage.emit()">
          <p-badge
            [value]="alertCounts.unresolved"
            severity="danger"
            *ngIf="alertCounts.unresolved > 0">
          </p-badge>
          <span class="text-sm text-gray-600">
            {{ alertCounts.unresolved }} unresolved
          </span>
        </button>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-6">

        <button
          type="button"
          class="p-4 rounded-lg text-center bg-surface-50 dark:bg-surface-800 border dark:border-surface-700 hover:opacity-80 transition"
          (click)="openDevicesPage.emit()">
          <div class="text-3xl font-bold">{{ alertCounts.high }}</div>
          <div class="text-sm mt-1">High</div>
        </button>

        <button
          type="button"
          class="p-4 rounded-lg text-center bg-surface-50 dark:bg-surface-800 border dark:border-surface-700 hover:opacity-80 transition"
          (click)="openDevicesPage.emit()">
          <div class="text-3xl font-bold">{{ alertCounts.critical }}</div>
          <div class="text-sm mt-1">Critical</div>
        </button>

      
      </div>

      <h4 class="text-lg font-semibold mb-3">Recent Alerts</h4>

      <div *ngIf="alerts.length === 0" class="text-sm text-gray-500">
        No active alerts.
      </div>

      <div class="space-y-3 max-h-80 overflow-y-auto pr-2" *ngIf="alerts.length > 0">
        <div
          *ngFor="let alert of alerts"
          class="p-3 rounded border-l-4 border dark:border-surface-700"
          [ngClass]="{
            'border-red-400': alert.severity === 'critical',
            'border-orange-400': alert.severity === 'high',
            'border-yellow-400': alert.severity === 'medium',
            'border-blue-400': alert.severity === 'low'
          }">

          <div class="flex justify-between items-start">
            <div>
              <span [class]="'px-2 py-1 rounded text-xs font-medium ' + getStatusColor(alert.severity)">
                {{ alert.severity.toUpperCase() }}
              </span>
              <div class="mt-2 text-sm">{{ alert.message }}</div>
            </div>

            <div class="flex items-center">
              <span class="text-xs mr-2">{{ formatTimeAgoFn(alert.timestamp) }}</span>
              <i *ngIf="alert.resolved" class="pi pi-check-circle text-green-500"></i>
              <i *ngIf="!alert.resolved" class="pi pi-exclamation-circle text-red-500"></i>
            </div>
          </div>
        </div>
      </div>
    </div>
  `
})
export class AlertsWidget {
  @Input({ required: true }) alerts!: Alert[];
  @Input({ required: true }) alertCounts!: {
    total: number;
    critical: number;
    high: number;
    unresolved: number;
  };
  @Input({ required: true }) formatTimeAgoFn!: (date: Date) => string;

  @Output() refresh = new EventEmitter<void>();
  @Output() openAlertsPage = new EventEmitter<void>();
  @Output() openDevicesPage = new EventEmitter<void>();


  getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      low: 'bg-blue-100 text-blue-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-orange-100 text-orange-800',
      critical: 'bg-red-100 text-red-800'
    };

    return colors[status] || 'bg-gray-100 text-gray-800';
  }
}