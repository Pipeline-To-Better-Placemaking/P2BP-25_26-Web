import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';

interface Schedule {
  date: string;
  time: string;
  frequency: string;
  endDate?: string;
  endTime?: string;
  id: number;
}

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

  public scanMessage: string | null = null;
  public scheduleMessage: string | null = null;

  public scheduledDate: string = '';
  public scheduledTime: string = '';
  public endDate: string = '';
  public endTime: string = '';

  public frequencyOptions: FrequencyOption[] = [
    { name: 'Never', code: 'Never' },
    { name: 'Weekly', code: 'Weekly' },
    { name: 'Monthly', code: 'Monthly' },
    { name: 'Yearly', code: 'Yearly' }
  ];

  public selectedFrequency: FrequencyOption | undefined;
  public schedules: Schedule[] = [];
  private scheduleIdCounter: number = 1;

  ngOnInit(): void {}

  // -----------------------------
  // Immediate Scan
  // -----------------------------
  public performScan(): void {
    this.scanMessage = 'Scan performed successfully!';
    setTimeout(() => this.scanMessage = null, 3000);
  }

  // -----------------------------
  // Schedule Scan
  // -----------------------------
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

    this.schedules.push({
      date: this.scheduledDate,
      time: this.scheduledTime,
      frequency: this.selectedFrequency.code,
      endDate: this.endDate || undefined,
      endTime: this.endTime || undefined,
      id: this.scheduleIdCounter++
    });

    this.scheduleMessage = 'Scan scheduled successfully!';
    this.clearForm();
    setTimeout(() => this.scheduleMessage = null, 3000);
  }

  // -----------------------------
  // Cancel / Edit Schedule
  // -----------------------------
  public cancelSchedule(id: number): void {
    this.schedules = this.schedules.filter(s => s.id !== id);
  }

  public editSchedule(schedule: Schedule): void {
    this.scheduledDate = schedule.date;
    this.scheduledTime = schedule.time;
    this.endDate = schedule.endDate || '';
    this.endTime = schedule.endTime || '';
    this.selectedFrequency = this.frequencyOptions.find(f => f.code === schedule.frequency);
    this.cancelSchedule(schedule.id);
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
  }

  public getScheduleFrequencyName(code: string): string {
    const freq = this.frequencyOptions.find(f => f.code === code);
    return freq ? freq.name : code;
  }

  public getMinEndDate(): string {
    return this.scheduledDate || '';
  }

}
