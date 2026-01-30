import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { SelectModule } from 'primeng/select';
import { FormsModule } from '@angular/forms';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';

interface Schedule {
  date: string;
  time: string;
  frequency: string;
  endDate?: string;
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
    CardModule,
    ButtonModule,
    InputTextModule,
    MessageModule,
    SelectModule,
    FormsModule,
    MenuModule
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

  public frequencyOptions: FrequencyOption[] = [
    { name: 'Never', code: 'Never' },
    { name: 'Weekly', code: 'Weekly' },
    { name: 'Monthly', code: 'Monthly' },
    { name: 'Yearly', code: 'Yearly' }
  ];
  public selectedFrequency: FrequencyOption | undefined;

  public schedules: Schedule[] = [];
  private scheduleIdCounter: number = 1;

  // Menu for schedule actions
  public scheduleMenuItems: MenuItem[] = [];
  private selectedSchedule: Schedule | null = null;

  ngOnInit(): void {
    this.buildScheduleMenu();
  }

  private buildScheduleMenu(): void {
    this.scheduleMenuItems = [
      {
        label: 'Cancel Schedule',
        icon: 'pi pi-times',
        command: () => {
          if (this.selectedSchedule) {
            this.cancelSchedule(this.selectedSchedule.id);
          }
        }
      },
      {
        label: 'Edit Schedule',
        icon: 'pi pi-pencil',
        command: () => {
          if (this.selectedSchedule) {
            this.editSchedule(this.selectedSchedule);
          }
        }
      }
    ];
  }

  public performScan(): void {
    this.scanMessage = 'Scan performed successfully!';

    // Clear message after 3 seconds
    setTimeout(() => {
      this.scanMessage = null;
    }, 3000);
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

    const newSchedule: Schedule = {
      date: this.scheduledDate,
      time: this.scheduledTime,
      frequency: this.selectedFrequency.code,
      endDate: this.endDate || undefined,
      id: this.scheduleIdCounter++
    };

    this.schedules.push(newSchedule);
    this.scheduleMessage = 'Scan scheduled successfully!';

    // Clear form
    this.clearForm();

    // Clear message after 3 seconds
    setTimeout(() => {
      this.scheduleMessage = null;
    }, 3000);
  }

  public cancelSchedule(id: number): void {
    const index = this.schedules.findIndex(s => s.id === id);
    if (index > -1) {
      this.schedules.splice(index, 1);
    }
  }

  public onScheduleMenuClick(event: MouseEvent, schedule: Schedule, menu: any): void {
    this.selectedSchedule = schedule;
    menu.toggle(event);
  }

  // CHANGED FROM PRIVATE TO PUBLIC
  public editSchedule(schedule: Schedule): void {
    // Populate form with selected schedule data
    this.scheduledDate = schedule.date;
    this.scheduledTime = schedule.time;
    this.endDate = schedule.endDate || '';
    this.selectedFrequency = this.frequencyOptions.find(f => f.code === schedule.frequency);

    // Remove the schedule being edited
    this.cancelSchedule(schedule.id);
  }

  private clearForm(): void {
    this.scheduledDate = '';
    this.scheduledTime = '';
    this.endDate = '';
    this.selectedFrequency = undefined;
  }

  public getScheduleFrequencyName(code: string): string {
    const freq = this.frequencyOptions.find(f => f.code === code);
    return freq ? freq.name : code;
  }
}
