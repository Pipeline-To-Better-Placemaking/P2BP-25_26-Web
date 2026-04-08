import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';

import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { DatePickerModule } from 'primeng/datepicker';
import { SelectModule } from 'primeng/select';

import { DeviceService } from '../../../../services/device-service';
import { DeviceDto } from '../../../../models/DeviceDto';
import { ScanService, ScanScheduleDto } from '../../../../services/scan-service';
import { PointCloudViewerComponent } from '../../../../components/point-cloud-viewer/point-cloud-viewer.component';
import { SolidObjectsViewComponent } from '../../../../solid-objects/solid-objects-view.component';

export type ScannerVisualMode = '3d' | 'solids';

interface FrequencyOption {
  name: string;
  code: string;
}

@Component({
  selector: 'app-scanner',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardModule,
    ButtonModule,
    InputTextModule,
    MessageModule,
    DatePickerModule,
    SelectModule,
    PointCloudViewerComponent,
    SolidObjectsViewComponent,
  ],
  templateUrl: './scanner.html',
  styleUrls: ['./scanner.scss']
})
export class Scanner implements OnInit {
  /** Public for template / child viewer (3D View + manual .xyz upload). */
  public projectId = '';

  /** Toggle 2D View (floor/clusters) vs 3D View (point cloud); default is 2D. */
  public visualMode: ScannerVisualMode = 'solids';

  public scanMessage: string | null = null;
  public scanning = false;
  public scheduleMessage: string | null = null;

  public scheduledDateTime: Date | null = null;
  public endDateTime: Date | null = null;


  public frequencyOptions: FrequencyOption[] = [
    { name: 'Never', code: 'Never' },
    { name: 'Weekly', code: 'Weekly' },
    { name: 'Monthly', code: 'Monthly' },
    { name: 'Yearly', code: 'Yearly' }
  ];

  public selectedFrequency: FrequencyOption | undefined;
  public schedules: ScanScheduleDto[] = [];
  public editingScheduleId: string | null = null;
  public minEndDate: Date | null = null;

  constructor(
    private route: ActivatedRoute,
    private deviceService: DeviceService,
    private scanService: ScanService
  ) {}

  ngOnInit(): void {
    this.projectId = this.route.snapshot.paramMap.get('projectId') ?? '';
    if (this.projectId) {
      this.loadSchedules();
    }
  }

  public setVisualMode(mode: ScannerVisualMode): void {
    this.visualMode = mode;
  }

  public performScan(): void {
    if (!this.projectId) {
      this.scanMessage = 'No project selected.';
      return;
    }

    this.scanning = true;
    this.scanMessage = null;

    this.deviceService.getDevices().subscribe({
      next: (devices: DeviceDto[]) => {
        const projectDevices = devices.filter(d => d.ProjectId === this.projectId);

        if (projectDevices.length === 0) {
          this.scanMessage = 'No devices assigned to this project.';
          this.scanning = false;
          return;
        }

        const scanRequests = projectDevices.map(d =>
          this.scanService.startScan(this.projectId, d.Id)
        );

        forkJoin(scanRequests).subscribe({
          next: (results) => {
            this.scanMessage = `Scan requested for ${results.length} device(s).`;
            this.scanning = false;
            setTimeout(() => this.scanMessage = null, 5000);
          },
          error: () => {
            this.scanMessage = 'Failed to start scan on one or more devices.';
            this.scanning = false;
          }
        });
      },
      error: () => {
        this.scanMessage = 'Failed to load devices.';
        this.scanning = false;
      }
    });
  }

  private loadSchedules(): void {
    this.scanService.getSchedules(this.projectId).subscribe({
      next: (schedules) => this.schedules = schedules,
      error: () => console.error('Failed to load scan schedules'),
    });
  }

  public scheduleScan(): void {
    if (!this.selectedFrequency) {
      this.scheduleMessage = 'Please select a frequency.';
      return;
    }

    if (!this.scheduledDateTime) {
      this.scheduleMessage = 'Please select a start date and time.';
      return;
    }

    if (this.selectedFrequency.code !== 'Never') {
      if (!this.endDateTime) {
        this.scheduleMessage = 'Please select an end date and time for recurring scans.';
        return;
      }

      if (this.endDateTime <= this.scheduledDateTime) {
        this.scheduleMessage = 'End date and time must be after start.';
        return;
      }
    }

    const payload: ScanScheduleDto = {
      StartDate: this.formatDate(this.scheduledDateTime),
      StartTime: this.formatTime(this.scheduledDateTime),
      Frequency: this.selectedFrequency.code,
      EndDate: this.endDateTime ? this.formatDate(this.endDateTime) : undefined,
      EndTime: this.endDateTime ? this.formatTime(this.endDateTime) : undefined,
    };

    if (this.editingScheduleId) {
      this.scanService.updateSchedule(this.projectId, this.editingScheduleId, payload).subscribe({
        next: () => {
          this.scheduleMessage = 'Schedule updated.';
          this.editingScheduleId = null;
          this.clearForm();
          this.loadSchedules();
          setTimeout(() => this.scheduleMessage = null, 3000);
        },
        error: () => this.scheduleMessage = 'Failed to update schedule.',
      });
    } else {
      this.scanService.createSchedule(this.projectId, payload).subscribe({
        next: () => {
          this.scheduleMessage = 'Scan scheduled successfully!';
          this.clearForm();
          this.loadSchedules();
          setTimeout(() => this.scheduleMessage = null, 3000);
        },
        error: () => this.scheduleMessage = 'Failed to save schedule.',
      });
    }
  }

  public cancelSchedule(id: string): void {
    this.scanService.deleteSchedule(this.projectId, id).subscribe({
      next: () => this.loadSchedules(),
      error: () => this.scheduleMessage = 'Failed to delete schedule.',
    });
  }

  public editSchedule(schedule: ScanScheduleDto): void {
    this.scheduledDateTime = this.combineDateAndTime(schedule.StartDate, schedule.StartTime);
    this.endDateTime = schedule.EndDate && schedule.EndTime
      ? this.combineDateAndTime(schedule.EndDate, schedule.EndTime)
      : null;

    this.selectedFrequency = this.frequencyOptions.find(f => f.code === schedule.Frequency);
    this.editingScheduleId = schedule.Id ?? null;
    this.minEndDate = this.scheduledDateTime;
  }

  public onStartDateTimeChange(): void {
    this.minEndDate = this.scheduledDateTime;

    if (this.scheduledDateTime && this.endDateTime && this.endDateTime <= this.scheduledDateTime) {
      this.endDateTime = null;
    }
  }

  private clearForm(): void {
    this.scheduledDateTime = null;
    this.endDateTime = null;
    this.selectedFrequency = undefined;
    this.editingScheduleId = null;
    this.minEndDate = null;
  }

  public getScheduleFrequencyName(code: string): string {
    const freq = this.frequencyOptions.find(f => f.code === code);
    return freq ? freq.name : code;
  }

  private formatDate(value: Date): string {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatTime(value: Date): string {
    const hours = String(value.getHours()).padStart(2, '0');
    const minutes = String(value.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private combineDateAndTime(dateStr: string, timeStr: string): Date {
    return new Date(`${dateStr}T${timeStr}`);
  }
}
