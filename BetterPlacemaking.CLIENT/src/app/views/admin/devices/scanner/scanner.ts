import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';

import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';

import { DeviceService } from '../../../../services/device-service';
import { DeviceDto } from '../../../../models/DeviceDto';
import { ScanService, ScanScheduleDto } from '../../../../services/scan-service';

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
    MessageModule
  ],
  templateUrl: './scanner.html',
  styleUrls: ['./scanner.scss']
})
export class Scanner implements OnInit {
  private projectId = '';

  public scanMessage: string | null = null;
  public scanning = false;
  public scheduleMessage: string | null = null;

  public scheduledDate = '';
  public scheduledTime = '';
  public endDate = '';
  public endTime = '';

  public frequencyOptions: FrequencyOption[] = [
    { name: 'Never', code: 'Never' },
    { name: 'Weekly', code: 'Weekly' },
    { name: 'Monthly', code: 'Monthly' },
    { name: 'Yearly', code: 'Yearly' }
  ];

  public selectedFrequency: FrequencyOption | undefined;
  public schedules: ScanScheduleDto[] = [];
  public editingScheduleId: string | null = null;

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

  // -----------------------------
  // Immediate Scan
  // -----------------------------
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

  // -----------------------------
  // Schedule CRUD
  // -----------------------------
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
    if (!this.scheduledDate || !this.scheduledTime) {
      this.scheduleMessage = 'Please select both date and time.';
      return;
    }
    if (this.selectedFrequency.code !== 'Never') {
      if (!this.endDate) {
        this.scheduleMessage = 'Please select an end date for recurring scans.';
        return;
      }
      if (!this.endTime) {
        this.scheduleMessage = 'Please select an end time for recurring scans.';
        return;
      }
      const start = new Date(`${this.scheduledDate}T${this.scheduledTime}`);
      const end = new Date(`${this.endDate}T${this.endTime}`);
      if (end <= start) {
        this.scheduleMessage = 'End date and time must be after start.';
        return;
      }
    }

    const payload: ScanScheduleDto = {
      StartDate: this.scheduledDate,
      StartTime: this.scheduledTime,
      Frequency: this.selectedFrequency.code,
      EndDate: this.endDate || undefined,
      EndTime: this.endTime || undefined,
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
    this.scheduledDate = schedule.StartDate;
    this.scheduledTime = schedule.StartTime;
    this.endDate = schedule.EndDate || '';
    this.endTime = schedule.EndTime || '';
    this.selectedFrequency = this.frequencyOptions.find(f => f.code === schedule.Frequency);
    this.editingScheduleId = schedule.Id ?? null;
  }

  // -----------------------------
  // Date / Time Change Handlers
  // -----------------------------
  public onStartDateChange(): void {
    if (this.endDate && this.scheduledDate) {
      if (this.endDate < this.scheduledDate) {
        this.endDate = '';
        this.endTime = '';
      } else if (this.endDate === this.scheduledDate && this.endTime && this.scheduledTime) {
        if (this.endTime <= this.scheduledTime) {
          this.endTime = '';
        }
      }
    }
  }

  public onStartTimeChange(): void {
    if (this.endDate && this.scheduledDate && this.endDate === this.scheduledDate) {
      if (this.endTime && this.scheduledTime && this.endTime <= this.scheduledTime) {
        this.endTime = '';
      }
    }
  }

  public onEndDateChange(): void {
    if (this.endDate && this.scheduledDate && this.endDate === this.scheduledDate) {
      if (this.endTime && this.scheduledTime && this.endTime <= this.scheduledTime) {
        this.endTime = '';
      }
    }
  }

  // -----------------------------
  // Helpers
  // -----------------------------
  private clearForm(): void {
    this.scheduledDate = '';
    this.scheduledTime = '';
    this.endDate = '';
    this.endTime = '';
    this.selectedFrequency = undefined;
    this.editingScheduleId = null;
  }

  public getScheduleFrequencyName(code: string): string {
    const freq = this.frequencyOptions.find(f => f.code === code);
    return freq ? freq.name : code;
  }

  public getMinEndDate(): string {
    return this.scheduledDate || '';
  }
}
