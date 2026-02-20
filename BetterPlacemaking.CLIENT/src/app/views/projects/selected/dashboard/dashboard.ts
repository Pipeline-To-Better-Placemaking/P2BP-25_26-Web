import { label } from './../../../../../../node_modules/@types/three/src/nodes/core/ContextNode.d';
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SplitterModule } from 'primeng/splitter';
import { CardModule } from 'primeng/card';
import { BadgeModule } from 'primeng/badge';
import { ProgressBarModule } from 'primeng/progressbar';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { DeviceService } from "../../../../services/device-service";
import { DeviceDto } from '../../../../models/DeviceDto';
import { HealthReport } from '../../../../models/jetson-dtos/HealthReport';

interface Project {
  title: string;
  status: 'active' | 'inactive' | 'completed';
  description: string;
  progress: number;
}

/*interface Device {
  id: string;
  name: string;
  type: string;
  status: 'online' | 'offline' | 'warning';
  lastSeen: Date;
}*/

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
  project: Project = {
    title: 'Better Placemaking SD 2026',
    status: 'active',
    description: 'Real-time monitoring of infrastructure and devices.',
    progress: 75
  };

  devices: DeviceDto[] = [];
  deviceCounts = { total: 0, online: 0, offline: 0, warning: 0 };
  loadingDevices = false;
  error: string | null = null;

  /*Device[] = [
    { id: 'D001', name: 'Firewall-01', type: 'Firewall', status: 'online', lastSeen: new Date() },
    { id: 'D002', name: 'Switch-Main', type: 'Switch', status: 'online', lastSeen: new Date() },
    { id: 'D003', name: 'Router-Core', type: 'Router', status: 'warning', lastSeen: new Date(Date.now() - 3600000) },
    { id: 'D004', name: 'IDS-Sensor', type: 'IDS', status: 'offline', lastSeen: new Date(Date.now() - 86400000) },
    { id: 'D005', name: 'Server-Web', type: 'Server', status: 'online', lastSeen: new Date() },
    { id: 'D006', name: 'AP-Wireless', type: 'Access Point', status: 'online', lastSeen: new Date() }
  ];*/

  alerts: Alert[] = [
    { id: 'A001', severity: 'high', message: 'Multiple failed login attempts detected', timestamp: new Date(Date.now() - 1800000), resolved: false },
    { id: 'A002', severity: 'medium', message: 'CPU usage above 90% on Firewall-01', timestamp: new Date(Date.now() - 3600000), resolved: true },
    { id: 'A003', severity: 'critical', message: 'Port scanning detected from external IP', timestamp: new Date(Date.now() - 600000), resolved: false },
    { id: 'A004', severity: 'low', message: 'Regular backup completed', timestamp: new Date(Date.now() - 7200000), resolved: true }
  ];

  lastScanTime: Date = new Date(Date.now() - 300000); // 5 minutes ago

  constructor(private deviceService: DeviceService) {}

  ngOnInit(): void {
    this.loadDevices();
  }

  loadDevices(): void {
    this.loadingDevices = true;
    this.deviceService.getDevices().subscribe({
      next: (data) => {
        this.devices = data;
        this.updateDeviceCounts();
        this.loadingDevices = false;
      },
      error: (err) => {
        console.error(err);
        this.error = 'Failed to load devices. Please try again later.';
        this.loadingDevices = false;
      }
    });
  }

  getDeviceStatus(device: DeviceDto): 'online' | 'offline' | 'warning' {
    if (!device.HealthReport) return 'offline';

    const hasWarning = Object.values(device.HealthReport.Services ?? {}).some(
      (s) => s.Active?.toLowerCase() !== 'ok'
    );

    return hasWarning ? 'warning' : 'online';
  }

  getStatusColor(status: string): string {
    const colors: any = {
      'active': 'bg-green-500',
      'inactive': 'bg-gray-400',
      'completed': 'bg-blue-500',
      'online': 'bg-green-500',
      'offline': 'bg-red-500',
      'warning': 'bg-yellow-500',
      'low': 'bg-blue-100 text-blue-800',
      'medium': 'bg-yellow-100 text-yellow-800',
      'high': 'bg-orange-100 text-orange-800',
      'critical': 'bg-red-100 text-red-800'
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  }

  private updateDeviceCounts(): void {
    const total = this.devices.length;
    let online =0;
    let offline =0;
    let warning =0;

    this.devices.forEach(d => {
      const status = this.getDeviceStatus(d);
      if (status === 'online') online++;
      else if (status === 'offline') offline++;
      else if (status === 'warning') warning++;
    });

    this.deviceCounts = { total, online, offline, warning };

  }

  getStatusBadge(status: string): string {
    const badges: any = {
      'active': 'Active',
      'inactive': 'Inactive',
      'completed': 'Completed',
      'online': 'Online',
      'offline': 'Offline',
      'warning': 'Warning'
    };
    return badges[status] || status;
  }


getBadgeSeverity(status: string): 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | null {
  const severityMap: Record<string, 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast' | null> = {
    'active': 'success',
    'inactive': 'warn',
    'completed': 'info',
    'online': 'success',
    'offline': 'danger',
    'warning': 'warn',
    'critical': 'danger',
    'high': 'danger',
    'medium': 'warn',
    'low': 'info'
  };
  return severityMap[status] || null;
}

 /* getDeviceCounts() {
    const total = this.devices.length;
    const online = this.devices.filter(d => d.status === 'online').length;
    const offline = this.devices.filter(d => d.status === 'offline').length;
    const warning = this.devices.filter(d => d.status === 'warning').length;
    return { total, online, offline, warning };
  }*/

  getAlertCounts() {
    const total = this.alerts.length;
    const critical = this.alerts.filter(a => a.severity === 'critical').length;
    const high = this.alerts.filter(a => a.severity === 'high').length;
    const unresolved = this.alerts.filter(a => !a.resolved).length;
    return { total, critical, high, unresolved };
  }

  refreshLastScan() {
    this.lastScanTime = new Date();
  }

  formatTimeAgo(date: Date): string {
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

  getDeviceLastSeen(device: DeviceDto): string {
    if (!device.HealthReport?.Timestamp) return 'N/A';
    return this.formatTimeAgo(new Date(device.HealthReport.Timestamp * 1000));
  }

  //ngOnInit(): void {
    // Initialization if needed
 /// }
}
