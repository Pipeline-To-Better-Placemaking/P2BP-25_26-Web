import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { DeviceService } from '../../../../services/device-service';
import { ProjectService } from '../../../../services/project-service';
import { ScanService } from '../../../../services/scan-service';
import { DeviceDto } from '../../../../models/DeviceDto';
import { ProjectDto } from '../../../../models/ProjectDto';
import { ServiceStatus } from '../../../../models/jetson-dtos/HealthReport';

import { StatsWidget } from './components/statswidget';
import { DevicesWidget } from './components/deviceswidget';
import { AlertsWidget } from './components/alertswidget';
import { ScanStatusWidget } from './components/scanstatuswidget';
import { ProjectChecklistWidget } from './components/projectchecklistwidget';

import { DialogModule } from 'primeng/dialog';

const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 30;
const HEARTBEAT_GRACE_MULTIPLIER = 6;
const MIN_ONLINE_WINDOW_MS = 2 * 60 * 1000;


export interface ProjectViewModel {
  title: string;
  status: 'active' | 'inactive' | 'completed';
  description: string;
  progress: number;
  checklistMessage: string | null;
}

export interface Alert {
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
    StatsWidget,
    DevicesWidget,
    AlertsWidget,
    ScanStatusWidget,
    ProjectChecklistWidget,
    DialogModule
  ],
  template: `
    <div class="rounded-xl">
      <div class="grid grid-cols-12 gap-6">

        <app-stats-widget
          class="contents"
          [project]="project"
          [deviceCounts]="deviceCounts"
          [alertCounts]="getAlertCounts()"
          (refresh)="loadDashboard()"
          (projectProgressClick)="onProjectProgressClick()"
          (devicesClick)="goToDevicesPage()"
          (warningsClick)="openAlertsDialog()"
          (alertsClick)="openAlertsDialog()">
        </app-stats-widget>


        <div class="col-span-12 xl:col-span-6 flex flex-col gap-6">
          <app-devices-widget
            [devices]="devices"
            [loading]="loading"
            [error]="error"
            [deviceStatusFn]="getDeviceStatus.bind(this)"
            [deviceLastSeenFn]="getDeviceLastSeen.bind(this)"
            (refresh)="loadDashboard()"
            (openDevicesPage)="goToDevicesPage()">
          </app-devices-widget>

          <app-scan-status-widget
            [lastScanTime]="lastScanTime"
            [formatTimeAgoFn]="formatTimeAgo.bind(this)"
            [scanLoading]="scanLoading"
            [scanMessage]="scanMessage"
            (refresh)="refreshLastScan()"
            (openModelPage)="goTo3DModelPage()"
            (runFullScan)="onRunFullScan()">
          </app-scan-status-widget>
        </div>

        <div class="col-span-12 xl:col-span-6 flex flex-col gap-6">
          <app-alerts-widget
            [alerts]="alerts"
            [alertCounts]="getAlertCounts()"
            (openDevicesPage)="goToDevicesPage()"   
            [formatTimeAgoFn]="formatTimeAgo.bind(this)"
            (refresh)="loadDashboard()"
            (openAlertsPage)="goToDevicesPage()">
          </app-alerts-widget>

          <div id="project-checklist-section">
            <app-project-checklist-widget
              [project]="project"
              (projectProgressClick)="onProjectProgressClick()"
              [deviceCounts]="deviceCounts"
              (refresh)="loadDashboard()"
              (devicesAddedClick)="goToDevicesPage()"
              (offlineDevicesFixedClick)="goToDevicesPage()"
              (warningsResolvedClick)="goToAlertsPage()">
            </app-project-checklist-widget>


            <p-dialog
              header="Project Checklist"
              [(visible)]="showProjectChecklistDialog"
              [modal]="true"
              [closable]="true"
              [draggable]="false"
              [resizable]="false"
              [maximizable]="true"
              [style]="{ width: '90vw' }"
              [contentStyle]="{ overflow: 'auto' }">

              <app-project-checklist-widget
                [project]="project"
                [deviceCounts]="deviceCounts"
                (refresh)="loadDashboard()"
                (devicesAddedClick)="goToDevicesPage(); showProjectChecklistDialog = false"
                (offlineDevicesFixedClick)="goToDevicesPage(); showProjectChecklistDialog = false"
                (warningsResolvedClick)="goToDevicesPage(); showProjectChecklistDialog = false">
              </app-project-checklist-widget>
            </p-dialog>

            <p-dialog
              header="Alerts"
              [(visible)]="showAlertsDialog"
              [modal]="true"
              [closable]="true"
              [draggable]="false"
              [resizable]="false"
              [maximizable]="true"
              [style]="{ width: '90vw' }"
              [contentStyle]="{ overflow: 'auto' }">

              <app-alerts-widget
                [alerts]="alerts"
                [alertCounts]="getAlertCounts()"
                (openDevicesPage)="goToDevicesPage(); showAlertsDialog = false"
                [formatTimeAgoFn]="formatTimeAgo.bind(this)"
                (refresh)="loadDashboard()"
                (openAlertsPage)="showAlertsDialog = false">
              </app-alerts-widget>
            </p-dialog>
          </div>
        </div>

      </div>
    </div>
  `
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
  public scanLoading = false;
  public scanMessage: string | null = null;

  public lastScanTime: Date = new Date();

  public showProjectChecklistDialog = false;
  public showAlertsDialog = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly deviceService: DeviceService,
    private readonly projectService: ProjectService,
    private readonly scanService: ScanService
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

  public openAlertsDialog(): void {
    this.showAlertsDialog = true;
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
        this.devices = devices ?? [];
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
    return this.devices.length > 0;
  }

  private getProjectChecklistMessage(): string | null {
    if (this.devices.length === 0) return 'Needs to add devices.';
    if (this.deviceCounts.offline > 0) return 'Needs to fix offline devices.';
    if (this.deviceCounts.warning > 0) return 'Needs to resolve device warnings.';
    return 'Project is ready.';
  }

  /*private calculateProjectProgress(): number {
    if (this.devices.length === 0) return 0;

    let progress = 100;
    if (this.deviceCounts.offline > 0) progress -= 35;
    if (this.deviceCounts.warning > 0) progress -= 15;

    return Math.max(25, Math.min(100, progress));
  }*/

  private calculateProjectProgress(): number {
  if (this.devices.length === 0) return 0;

  const total = this.deviceCounts.total;
  const offlineRatio = this.deviceCounts.offline / total;
  const warningRatio = this.deviceCounts.warning / total;

  let progress = 100;

  progress -= offlineRatio * 60;  // offline = big impact
  progress -= warningRatio * 30;  // warnings = medium impact

  return Math.max(0, Math.round(progress));
}

  private getProjectStatus(progress: number, started: boolean): 'active' | 'inactive' | 'completed' {
    if (!started) return 'inactive';
    if (progress >= 100) return 'completed';
    return 'active';
  }

  private updateDeviceCounts(): void {
    const total = this.devices.length;
    let online = 0;
    let offline = 0;
    let warning = 0;

    this.devices.forEach(device => {
      const status = this.getDeviceStatus(device);
      if (status === 'online') online++;
      else if (status === 'offline') offline++;
      else warning++;
    });

    this.deviceCounts = { total, online, offline, warning };
  }

  public getDeviceStatus(device: DeviceDto): 'online' | 'offline' | 'warning' {
    if (!this.isHeartbeatFresh(device)) {
      return 'offline';
    }

    const services = device.HealthReport?.Services;
    if (!services) {
      return 'warning';
    }

    const serviceStates = Object.values(services)
      .map((s: ServiceStatus) => (s.Active ?? '').toLowerCase());

    if (serviceStates.length === 0) {
      return 'warning';
    }

    const hasDegradedState = serviceStates.some(
      state => state !== 'active' && state !== 'activating',
    );

    return hasDegradedState ? 'warning' : 'online';
  }

  private buildAlerts(): void {
    const now = new Date();
    const alerts: Alert[] = [];

    this.devices.forEach((device, index) => {
      const status = this.getDeviceStatus(device);
      const timestamp = this.getHealthReportDate(device) ?? now;
      const deviceName = device.Name || 'Unnamed device';

      if (status === 'offline') {
        const lastSeen = this.getDeviceLastSeen(device);

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

        alerts.push({
          id: `device-offline-${device.Id ?? index}`,
          severity: 'critical',
          message: `${deviceName} has not reported recently (last seen ${lastSeen}).`,
          timestamp,
          resolved: false
        });

        return;
      }

      if (status === 'warning') {
        const warningServices = Object.entries(device.HealthReport?.Services ?? {})
          .filter(([, service]) => {
            const typedService = service as ServiceStatus;
            const state = (typedService.Active ?? '').toLowerCase();
            return state !== 'active' && state !== 'activating';
          })
          .map(([serviceName, service]) => {
            const typedService = service as ServiceStatus;
            return `${serviceName} (${typedService.Active ?? 'unknown'})`;
          });

        alerts.push({
          id: `device-warning-${device.Id ?? index}`,
          severity: 'high',
          message: warningServices.length > 0
            ? `${deviceName} has degraded services: ${warningServices.join(', ')}.`
            : `${deviceName} is reporting but service health is incomplete.`,
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
    if (!timestamp) return null;

    const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
    const date = new Date(ms);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  private isHeartbeatFresh(device: DeviceDto): boolean {
    const lastReportDate = this.getHealthReportDate(device);
    if (!lastReportDate) {
      return false;
    }

    const configuredInterval = Number(device.Config?.HeartbeatInterval);
    const heartbeatIntervalSeconds = Number.isFinite(configuredInterval) && configuredInterval > 0
      ? configuredInterval
      : DEFAULT_HEARTBEAT_INTERVAL_SECONDS;

    const maxAgeMs = Math.max(
      MIN_ONLINE_WINDOW_MS,
      heartbeatIntervalSeconds * 1000 * HEARTBEAT_GRACE_MULTIPLIER,
    );

    return Date.now() - lastReportDate.getTime() <= maxAgeMs;
  }

  public getDeviceLastSeen(device: DeviceDto): string {
    const date = this.getHealthReportDate(device);
    if (!date) return 'N/A';
    return this.formatTimeAgo(date);
  }

  public getAlertCounts(): { total: number; critical: number; high: number; unresolved: number } {
    const total = this.alerts.length;
    const critical = this.alerts.filter(a => a.severity === 'critical').length;
    const high = this.alerts.filter(a => a.severity === 'high').length;
    const unresolved = this.alerts.filter(a => !a.resolved).length;

    return { total, high, critical, unresolved };
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

//Public onProjectProgressClick(): void {
  //const checklistElement = document.getElementById('project-checklist-section');

  //if (checklistElement) {
    //checklistElement.scrollIntoView({
      //behavior: 'smooth',
      //block: 'center'
    //});
  //}
//}
public onProjectProgressClick(): void {
  this.showProjectChecklistDialog = true;
}


public goToDevicesPage(): void {
  if (!this.projectId) return;
  this.router.navigate(['/', this.projectId, 'admin', 'devices']);
}

public goTo3DModelPage(): void {
  if (!this.projectId) return;
  this.router.navigate(['/', this.projectId, 'model']);
}


public goToAlertsPage(): void {
  this.showAlertsDialog = true;
}

public onRunFullScan(): void {
  if (!this.projectId) return;

  this.scanLoading = true;
  this.scanMessage = null;

  const projectDevices = this.devices.filter(d => d.ProjectId === this.projectId);

  if (projectDevices.length === 0) {
    this.scanMessage = 'No devices assigned to this project.';
    this.scanLoading = false;
    return;
  }

  const scanRequests = projectDevices.map(d =>
    this.scanService.startScan(this.projectId!, d.Id)
  );

  forkJoin(scanRequests).subscribe({
    next: (results) => {
      this.scanMessage = `Scan requested for ${results.length} device(s).`;
      this.scanLoading = false;
      setTimeout(() => this.scanMessage = null, 5000);
    },
    error: () => {
      this.scanMessage = 'Failed to start scan.';
      this.scanLoading = false;
    }
  });
}
}