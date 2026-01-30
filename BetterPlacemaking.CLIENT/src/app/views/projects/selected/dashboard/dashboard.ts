// dashboard.component.ts (or dashboard.ts if you keep that name)
import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SplitterModule } from 'primeng/splitter';
import { CardModule } from 'primeng/card';
import { BadgeModule } from 'primeng/badge';
import { ProgressBarModule } from 'primeng/progressbar';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';

interface Project {
  title: string;
  status: 'active' | 'inactive' | 'completed';
  description: string;
  progress: number;
}

interface Device {
  id: string;
  name: string;
  type: string;
  status: 'online' | 'offline' | 'warning';
  lastSeen: Date;
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
  templateUrl: './dashboard.html', // Make sure this matches your HTML file name
  styleUrls: ['./dashboard.scss']  // Make sure this matches your SCSS file name
})
export class Dashboard implements OnInit {
  project: Project = {
    title: 'Network Security Monitoring',
    status: 'active',
    description: 'Real-time monitoring of network infrastructure and security devices across multiple locations.',
    progress: 75
  };

  devices: Device[] = [
    { id: 'D001', name: 'Firewall-01', type: 'Firewall', status: 'online', lastSeen: new Date() },
    { id: 'D002', name: 'Switch-Main', type: 'Switch', status: 'online', lastSeen: new Date() },
    { id: 'D003', name: 'Router-Core', type: 'Router', status: 'warning', lastSeen: new Date(Date.now() - 3600000) },
    { id: 'D004', name: 'IDS-Sensor', type: 'IDS', status: 'offline', lastSeen: new Date(Date.now() - 86400000) },
    { id: 'D005', name: 'Server-Web', type: 'Server', status: 'online', lastSeen: new Date() },
    { id: 'D006', name: 'AP-Wireless', type: 'Access Point', status: 'online', lastSeen: new Date() }
  ];

  alerts: Alert[] = [
    { id: 'A001', severity: 'high', message: 'Multiple failed login attempts detected', timestamp: new Date(Date.now() - 1800000), resolved: false },
    { id: 'A002', severity: 'medium', message: 'CPU usage above 90% on Firewall-01', timestamp: new Date(Date.now() - 3600000), resolved: true },
    { id: 'A003', severity: 'critical', message: 'Port scanning detected from external IP', timestamp: new Date(Date.now() - 600000), resolved: false },
    { id: 'A004', severity: 'low', message: 'Regular backup completed', timestamp: new Date(Date.now() - 7200000), resolved: true }
  ];

  lastScanTime: Date = new Date(Date.now() - 300000); // 5 minutes ago

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

 // dashboard.component.ts - Update the getBadgeSeverity method
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

  getDeviceCounts() {
    const total = this.devices.length;
    const online = this.devices.filter(d => d.status === 'online').length;
    const offline = this.devices.filter(d => d.status === 'offline').length;
    const warning = this.devices.filter(d => d.status === 'warning').length;
    return { total, online, offline, warning };
  }

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

  ngOnInit(): void {
    // Initialization if needed
  }
}
