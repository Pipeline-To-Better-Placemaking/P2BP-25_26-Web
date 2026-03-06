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
  selector: 'app-project-checklist-widget',
  imports: [CommonModule, ButtonModule],
  template: `

   <div class="card bg-surface-0 dark:bg-surface-900 shadow-sm rounded-xl border border-surface-300 dark:border-surface-700 p-6 bg-black">

   <div class="flex items-center justify-between mb-6">
        <h3 class="text-xl font-semibold">Project Checklist</h3>
        <p-button
          icon="pi pi-refresh"
          [text]="true"
          [rounded]="true"
          (onClick)="refresh.emit()">
        </p-button>
      </div>

      <div class="mb-4">
        <div class="text-lg font-semibold">{{ project.title }}</div>
        <div class="text-sm text-muted-color mt-1">{{ project.description }}</div>
      </div>

      <div class="mb-4 p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
        <div class="text-sm font-medium mb-2">Current Status</div>
        <div class="text-sm text-orange-600" *ngIf="project.checklistMessage">
          {{ project.checklistMessage }}
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex justify-between items-center border-b border-surface-200 dark:border-surface-700 pb-2">
          <span>Devices added</span>
          <span class="font-medium">{{ deviceCounts.total > 0 ? 'Yes' : 'No' }}</span>
        </div>

        <div class="flex justify-between items-center border-b border-surface-200 dark:border-surface-700 pb-2">
          <span>Offline devices fixed</span>
          <span class="font-medium">{{ deviceCounts.offline === 0 ? 'Yes' : 'No' }}</span>
        </div>

        <div class="flex justify-between items-center border-b border-surface-200 dark:border-surface-700 pb-2">
          <span>Warnings resolved</span>
          <span class="font-medium">{{ deviceCounts.warning === 0 ? 'Yes' : 'No' }}</span>
        </div>

        <div class="flex justify-between items-center">
          <span>Project ready</span>
          <span class="font-medium">{{ project.progress === 100 ? 'Yes' : 'No' }}</span>
        </div>
      </div>
    </div>
  `
})
export class ProjectChecklistWidget {
  @Input({ required: true }) project!: ProjectViewModel;
  @Input({ required: true }) deviceCounts!: { total: number; online: number; offline: number; warning: number };
  @Output() refresh = new EventEmitter<void>();
}
