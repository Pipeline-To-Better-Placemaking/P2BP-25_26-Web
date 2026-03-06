import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { SplitterModule } from 'primeng/splitter';
import { CardModule } from 'primeng/card';
import { BadgeModule } from 'primeng/badge';
import { ProgressBarModule } from 'primeng/progressbar';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

import { DeviceService } from '../../../../services/device-service';
import { ProjectService } from '../../../../services/project-service';
import { DeviceDto } from '../../../../models/DeviceDto';
import { ProjectDto } from '../../../../models/ProjectDto';

interface ProjectViewModel {
  title: string;
  status: 'active' | 'inactive' | 'completed';
  description: string;
  progress: number;
  checklistMessage: string | null;
}

interface Alert {
  id: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  timestamp: Date;
  resolved: boolean;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule,
    SplitterModule,
    CardModule,
    BadgeModule,
    ProgressBarModule,
    ButtonModule,
    TooltipModule
  ],
  templateUrl: './dashboard.html',
  styleUrls: ['./dashboard.scss']
})
export class Dashboard implements OnInit {
  public projectId: string | null = null;

  public project: ProjectViewModel = {
    title: 'Project',
    status: 'inactive',
    description: 'No project selected.',
    progress: 0,
    checklistMessage: 'Needs to add devices.'
  };

  public devices: DeviceDto[] = [];
  public deviceCounts = { total: 0, online: 0, offline: 0, warning: 0 };
  public alerts: Alert[] = [];

  public loading = false;
  public error: string | null = null;

  public lastScanTime: Date = new Date();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly deviceService: DeviceService,
    private readonly projectService: ProjectService
  ) {}

  ngOnInit(): void {
    const routeProjectId = this.route.snapshot.paramMap.get('projectId');
    const storedProjectId = localStorage.getItem('selectedProjectId');

    this.projectId = routeProjectId || storedProjectId;

    if (!this.projectId) {
      this.error = 'No project selected.';
      return;
    }

    localStorage.setItem('selectedProjectId', this.projectId);
    this.loadDashboard();
  }

  public loadDashboard(): void {
    if (!this.projectId) {
      this.error = 'No project selected.';
      return;
    }

    this.loading = true;
    this.error = null;

    forkJoin({
      project: this.projectService.getProject(this.projectId).pipe(catchError(() => of(null))),
      devices: this.deviceService.getDevices().pipe(catchError(() => of([] as DeviceDto[])))
    }).subscribe({
      next: ({ project, devices }) => {
        // TEMPORARY:
        // Devices are not yet nested under projects, so use all devices for now.
        this.devices = devices ?? [];

        /*
        // FUTURE:
        // Restore project-specific filtering after devices are moved under projects.
        this.devices = (devices ?? []).filter(d => d.ProjectId === this.projectId);
        */

        this.updateDeviceCounts();
        this.buildProject(project);
        this.buildAlerts();
        this.updateLastScanTime();

        this.loading = false;
      },
      error: (err) => {
        console.error(err);
        this.error = 'Failed to load dashboard data.';
        this.loading = false;
      }
    });
  }

  private buildProject(projectDto: ProjectDto | null): void {
    const progress = this.calculateProjectProgress();
    const checklistMessage = this.getProjectChecklistMessage();
    const started = this.hasProjectStarted();

    this.project = {
      title: projectDto?.Title || 'Untitled Project',
      description: projectDto?.Description || 'No description available.',
      status: this.getProjectStatus(progress, started),
      progress,
      checklistMessage
    };
  }

  private hasProjectStarted(): boolean {
    // TEMPORARY:
    // Since devices are still global, treat "has any loaded devices" as project started.
    return this.devices.length > 0;
  }

  private getProjectChecklistMessage(): string | null {
    if (this.devices.length === 0) {
      return 'Needs to add devices.';
    }

    if (this.deviceCounts.offline > 0) {
      return 'Needs to fix offline devices.';
    }

    if (this.deviceCounts.warning > 0) {
      return 'Needs to resolve device warnings.';
    }

    return null;
  }

  private calculateProjectProgress(): number {
    // Initial project setup:
    // If nothing exists yet, progress should be 0.
    if (this.devices.length === 0) {
      return 0;
    }

    // Once a project has started, it should never fall back to 0
    // unless everything is removed.
    let progress = 100;

    if (this.deviceCounts.offline > 0) {
      progress -= 35;
    }

    if (this.deviceCounts.warning > 0) {
      progress -= 15;
    }

    return Math.max(25, Math.min(100, progress));
  }

  private getProjectStatus(progress: number, started: boolean): 'active' | 'inactive' | 'completed' {
    if (!started) {
      return 'inactive';
    }

    if (progress >= 100) {
      return 'completed';
    }

    return 'active';
  }

  private updateDeviceCounts(): void {
  const total = this.devices.length;
  let online = 0;
  let offline = 0;
  let warning = 0;

  this.devices.forEach(device => {
    const status = this.getDeviceStatus(device);

    if (status === 'online') {
      online++;
    } else if (status === 'offline') {
      offline++;
    } else {
      warning++;
    }
  });

  this.deviceCounts = { total, online, offline, warning };
}

  public getDeviceStatus(device: DeviceDto): 'online' | 'offline' | 'warning' {
  if (!device.HealthReport?.Services) {
    return 'offline';
  }

  const serviceStates = Object.values(device.HealthReport.Services)
    .map(s => (s.Active ?? '').toLowerCase());

  const hasOfflineState = serviceStates.some(state =>
    state === 'inactive' || state === 'failed' || state === 'dead'
  );

  if (hasOfflineState) {
    return 'offline';
  }

  const allHealthy = serviceStates.every(state =>
    state === 'active' || state === 'activating'
  );

  if (allHealthy) {
    return 'online';
  }

  return 'warning';
}

  private buildAlerts(): void {
  const now = new Date();
  const alerts: Alert[] = [];

  this.devices.forEach((device, index) => {
    const status = this.getDeviceStatus(device);
    const timestamp = this.getHealthReportDate(device) ?? now;
    const deviceName = device.Name || 'Unnamed device';

    if (status === 'offline') {
      if (!device.HealthReport) {
        alerts.push({
          id: `device-offline-no-report-${device.Id ?? index}`,
          severity: 'critical',
          message: `${deviceName} is offline and not reporting health data.`,
          timestamp,
          resolved: false
        });
        return;
      }

      const failedServices = Object.entries(device.HealthReport.Services ?? {})
        .filter(([, service]) => {
          const state = (service.Active ?? '').toLowerCase();
          return state === 'inactive' || state === 'failed' || state === 'dead';
        })
        .map(([serviceName, service]) => `${serviceName} (${service.Active ?? 'unknown'})`);

      alerts.push({
        id: `device-offline-${device.Id ?? index}`,
        severity: 'critical',
        message: failedServices.length > 0
          ? `${deviceName} has offline services: ${failedServices.join(', ')}.`
          : `${deviceName} is offline.`,
        timestamp,
        resolved: false
      });

      return;
    }

    if (status === 'warning') {
      const warningServices = Object.entries(device.HealthReport?.Services ?? {})
        .filter(([, service]) => {
          const state = (service.Active ?? '').toLowerCase();
          return state !== 'active' &&
                 state !== 'activating' &&
                 state !== 'inactive' &&
                 state !== 'failed' &&
                 state !== 'dead';
        })
        .map(([serviceName, service]) => `${serviceName} (${service.Active ?? 'unknown'})`);

      alerts.push({
        id: `device-warning-${device.Id ?? index}`,
        severity: 'high',
        message: warningServices.length > 0
          ? `${deviceName} has unexpected service states: ${warningServices.join(', ')}.`
          : `${deviceName} has one or more services requiring attention.`,
        timestamp,
        resolved: false
      });
    }
  });

  this.alerts = alerts;
}

  private updateLastScanTime(): void {
    const validDates = this.devices
      .map(d => this.getHealthReportDate(d))
      .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));

    if (validDates.length > 0) {
      validDates.sort((a, b) => b.getTime() - a.getTime());
      this.lastScanTime = validDates[0];
    }
  }

  private getHealthReportDate(device: DeviceDto): Date | null {
    const timestamp = device.HealthReport?.Timestamp;
    if (!timestamp) {
      return null;
    }

    const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    const date = new Date(ms);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  public getDeviceLastSeen(device: DeviceDto): string {
    const date = this.getHealthReportDate(device);
    if (!date) {
      return 'N/A';
    }

    return this.formatTimeAgo(date);
  }

  public getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      active: 'bg-green-500',
      inactive: 'bg-gray-400',
      completed: 'bg-blue-500',
      online: 'bg-green-500',
      offline: 'bg-red-500',
      warning: 'bg-yellow-500',
      low: 'bg-blue-100 text-blue-800',
      medium: 'bg-yellow-100 text-yellow-800',
      high: 'bg-orange-100 text-orange-800',
      critical: 'bg-red-100 text-red-800'
    };

    return colors[status] || 'bg-gray-100 text-gray-800';
  }

  public getStatusBadge(status: string): string {
    const badges: Record<string, string> = {
      active: 'Active',
      inactive: 'Inactive',
      completed: 'Ready',
      online: 'Online',
      offline: 'Offline',
      warning: 'Warning'
    };

    return badges[status] || status;
  }

  public getBadgeSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | null {
    const severityMap: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | null> = {
      active: 'warn',
      inactive: 'danger',
      completed: 'success',
      online: 'success',
      offline: 'danger',
      warning: 'warn',
      critical: 'danger',
      high: 'danger',
      medium: 'warn',
      low: 'info'
    };

    return severityMap[status] || null;
  }

  public getAlertCounts(): { total: number; critical: number; high: number; unresolved: number } {
    const total = this.alerts.length;
    const critical = this.alerts.filter(a => a.severity === 'critical').length;
    const high = this.alerts.filter(a => a.severity === 'high').length;
    const unresolved = this.alerts.filter(a => !a.resolved).length;

    return { total, critical, high, unresolved };
  }

  public refreshLastScan(): void {
    this.loadDashboard();
  }

  public formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }
}
