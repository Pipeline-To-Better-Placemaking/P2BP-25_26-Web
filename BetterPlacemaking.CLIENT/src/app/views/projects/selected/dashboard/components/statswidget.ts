import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

interface ProjectViewModel {
  title: string;
  status: 'active' | 'inactive' | 'completed';
  description: string;
  progress: number;
  checklistMessage: string | null;
}

@Component({
  standalone: true,
  selector: 'app-stats-widget',
  imports: [CommonModule, ButtonModule],
  template: `
    <div
      class="col-span-12 lg:col-span-6 xl:col-span-4 bg-surface-0 dark:bg-surface-900 shadow-sm rounded-xl border border-surface-300 dark:border-surface-700 p-6 bg-black cursor-pointer hover:opacity-95 transition"
      (click)="projectProgressClick.emit()">

      <div class="card shadow-sm mb-0">
        <div class="flex justify-between mb-4">
          <div>
            <span class="block text-muted-color font-medium mb-4">Project Progress</span>
            <div class="text-surface-900 dark:text-surface-0 font-medium text-xl">{{ project.progress }}%</div>
          </div>
          <div class="flex items-center gap-2">
            <p-button
              icon="pi pi-refresh"
              [text]="true"
              [rounded]="true"
              (onClick)="onRefreshClick($event)">
            </p-button>
            <!--<div class="flex items-center justify-center bg-blue-100 dark:bg-blue-400/10 rounded-border" style="width: 2.5rem; height: 2.5rem">
              <i class="pi pi-chart-line text-blue-500 text-xl!"></i>
            </div>-->
          </div>
        </div>
        <span class="text-primary font-medium">{{ project.status | titlecase }}</span>
        <span class="text-muted-color"> project status</span>
      </div>
    </div>

    <div
      class="col-span-12 lg:col-span-6 xl:col-span-4 bg-surface-0 dark:bg-surface-900 shadow-sm rounded-xl border border-surface-300 dark:border-surface-700 p-6 bg-black cursor-pointer hover:opacity-95 transition"
      (click)="devicesClick.emit()">

      <div class="card shadow-sm mb-0">
        <div class="flex justify-between mb-4">
          <div>
            <span class="block text-muted-color font-medium mb-4">Devices</span>
            <div class="text-surface-900 dark:text-surface-0 font-medium text-xl">{{ deviceCounts.total }}</div>
          </div>
          <!--<div class="flex items-center justify-center bg-cyan-100 dark:bg-cyan-400/10 rounded-border" style="width: 2.5rem; height: 2.5rem">
            <i class="pi pi-desktop text-cyan-500 text-xl!"></i>
          </div> -->
        </div>
        <span class="text-primary font-medium">{{ deviceCounts.online }}</span>
        <span class="text-muted-color"> online now</span>
      </div>
    </div>

    <!--<div class="col-span-12 lg:col-span-6 xl:col-span-3 bg-surface-0 dark:bg-surface-900 shadow-sm rounded-xl border border-surface-300 dark:border-surface-700 p-6 bg-black cursor-pointer hover:opacity-95 transition"
      (click)="warningsClick.emit()">
      <div class="card shadow-sm mb-0">
        <div class="flex justify-between mb-4">
          <div>
            <span class="block text-muted-color font-medium mb-4">Warnings</span>
            <div class="text-surface-900 dark:text-surface-0 font-medium text-xl">{{ deviceCounts.warning }}</div>
          </div>
          <div class="flex items-center gap-2">
            <p-button
              icon="pi pi-refresh"
              [text]="true"
              [rounded]="true"
              (onClick)="onRefreshClick($event)">
            </p-button>
          <div class="flex items-center justify-center bg-orange-100 dark:bg-orange-400/10 rounded-border" style="width: 2.5rem; height: 2.5rem">
            <i class="pi pi-exclamation-triangle text-orange-500 text-xl!"></i>
          </div>
        </div>
      </div>
        <span class="text-primary font-medium">{{ deviceCounts.offline }}</span>
        <span class="text-muted-color"> offline devices</span>
      </div>
    </div>-->

    <div class="col-span-12 lg:col-span-6 xl:col-span-4 bg-surface-0 dark:bg-surface-900 shadow-sm rounded-xl border border-surface-300 dark:border-surface-700 p-6 bg-black cursor-pointer hover:opacity-95 transition"
      (click)="alertsClick.emit()">
      <div class="card shadow-sm mb-0">
        <div class="flex justify-between mb-4">
          <div>
            <span class="block text-muted-color font-medium mb-4">Alerts</span>
            <div class="text-surface-900 dark:text-surface-0 font-medium text-xl">{{ alertCounts.unresolved }}</div>
          </div>
          <div class="flex items-center gap-2">
            <p-button
              icon="pi pi-refresh"
              [text]="true"
              [rounded]="true"
              (onClick)="onRefreshClick($event)">
            </p-button>
            <!--<div class="flex items-center justify-center bg-purple-100 dark:bg-purple-400/10 rounded-border" style="width: 2.5rem; height: 2.5rem">
              <i class="pi pi-bell text-purple-500 text-xl!"></i>
            </div>-->
          </div>
        </div>
        <span class="text-primary font-medium">{{ alertCounts.critical }}</span>
        <span class="text-muted-color"> critical alerts</span>
      </div>
    </div>
  `
})
export class StatsWidget {
  @Input({ required: true }) project!: ProjectViewModel;
  @Input({ required: true }) deviceCounts!: { total: number; online: number; offline: number; warning: number };
  @Input({ required: true }) alertCounts!: { total: number; critical: number; high: number; unresolved: number };

  @Output() refresh = new EventEmitter<void>();
  @Output() projectProgressClick = new EventEmitter<void>();
  @Output() devicesClick = new EventEmitter<void>();
  @Output() warningsClick = new EventEmitter<void>();
  @Output() alertsClick = new EventEmitter<void>();

  public onRefreshClick(event: Event): void {
    event.stopPropagation();
    this.refresh.emit();
  }
}