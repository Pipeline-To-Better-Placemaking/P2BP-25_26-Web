import { CommonModule } from '@angular/common';
import { Component, Input, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { ActivatedRoute } from '@angular/router';

import { DeviceService } from '../../../../services/device-service';
import { DeviceDto } from '../../../../models/DeviceDto';
import { PermissionDirective } from '../../../../directives/permission.directive';

interface LidarPlacement {
  deviceId: string;
  name: string;
  x: number;
  y: number;
  yawDeg: number;
}

@Component({
  standalone: true,
  selector: 'app-multi-lidar-calibration',
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    InputTextModule,
    PermissionDirective
  ],
  templateUrl: './multi-lidar-calibration.html',
  styleUrls: ['./multi-lidar-calibration.scss']
})
export class MultiLidarCalibration implements OnInit {
  @Input() projectId: string = '';
  @Input() floorPlan: any | null = null;

  placements: LidarPlacement[] = [];
  selected: LidarPlacement | null = null;
  dragging: LidarPlacement | null = null;

  constructor(
    private deviceService: DeviceService,
    private route: ActivatedRoute,
  ) {}

  ngOnInit(): void {
    this.projectId ||= this.route.snapshot.paramMap.get('projectId') ?? '';
    this.loadDevices();
  }

  loadDevices(): void {
    this.deviceService.getDevices().subscribe((devices: DeviceDto[]) => {
      const lidars = devices.filter((d: DeviceDto) =>
        d.ProjectId === this.projectId &&
        d.Name?.toLowerCase().includes('lidar')
      );

      this.placements = lidars.map((d: DeviceDto) => ({
        deviceId: d.Id,
        name: d.Name ?? 'LiDAR',
        x: Math.random() * 400,
        y: Math.random() * 300,
        yawDeg: 0
      }));
    });
  }

  select(p: LidarPlacement): void {
    this.selected = p;
  }

  startDrag(event: MouseEvent, p: LidarPlacement): void {
    this.dragging = p;
  }

  onDrag(event: MouseEvent): void {
    if (!this.dragging) return;

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.dragging.x = event.clientX - rect.left;
    this.dragging.y = event.clientY - rect.top;
  }

  stopDrag(): void {
    this.dragging = null;
  }

  rotateSelected(delta: number): void {
    if (!this.selected) return;
    this.selected.yawDeg = (this.selected.yawDeg + delta) % 360;
  }

  save(): void {
    localStorage.setItem(
      `lidar-calibration-${this.projectId}`,
      JSON.stringify(this.placements)
    );
    alert('Calibration saved');
  }

  load(): void {
    const data = localStorage.getItem(`lidar-calibration-${this.projectId}`);
    if (data) {
      this.placements = JSON.parse(data);
    }
  }

  reset(): void {
    this.loadDevices();
  }
}
