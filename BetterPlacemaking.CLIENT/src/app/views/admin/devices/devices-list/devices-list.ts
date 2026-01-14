import { Component, OnInit } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { MenuModule, Menu } from 'primeng/menu';
import { DeviceDto } from '../../../../models/DeviceDto';
import { DeviceService } from '../../../../services/device-service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { DeviceForm } from '../device-form/device-form';
import { MenuItem } from 'primeng/api';
import { DeviceApiInfo } from '../device-api-info/device-api-info';
import { DeviceHealthReport } from '../device-health-report/device-health-report';

@Component({
  selector: 'app-devices-list',
  imports: [TableModule, ButtonModule, MenuModule],
  providers: [DialogService],
  templateUrl: './devices-list.html',
  styleUrl: './devices-list.scss',
})
export class DevicesList implements OnInit {
  public devices: DeviceDto[] = [];

  public rowMenuItems: MenuItem[] = [];
  private selectedDevice: DeviceDto | null = null;

  formRef: DynamicDialogRef<DeviceForm> | null = null;
  apiInfoRef: DynamicDialogRef<DeviceApiInfo> | null = null;
  healthReportRef: DynamicDialogRef<DeviceHealthReport> | null = null;

  public constructor(
    private readonly deviceService: DeviceService,
    private readonly dialogService: DialogService
  ) {}

  ngOnInit(): void {
    this.loadDevices();
    this.buildDrowndownMenu();
  }

  private loadDevices(): void {
    this.deviceService.getDevices().subscribe({
      next: (devices) => {
        console.log(devices);
        this.devices = devices;
        console.log('Devices loaded:', this.devices);
      },
      error: (err) => {
        console.error('Error loading devices:', err);
      },
    });
  }

  public buildDrowndownMenu(): void {
    this.rowMenuItems = [
      {
        label: 'Edit',
        icon: 'pi pi-pencil',
        command: () => {
          if (this.selectedDevice) {
            this.editDevice(this.selectedDevice);
          }
        },
      },
      {
        label: 'Health Report',
        icon: 'pi pi-heart',
        command: () => {
          if (this.selectedDevice) {
            this.openHealthReport(this.selectedDevice);
          }
        },
      },
      {
        label: 'Delete',
        icon: 'pi pi-trash',
        command: () => {
          if (this.selectedDevice) {
            this.deleteDevice(this.selectedDevice);
          }
        },
      },
      {
        label: 'Get API Key',
        icon: 'pi pi-key',
        command: () => {
          if (this.selectedDevice) {
            this.getAndDisplayApiKey(this.selectedDevice.Id);
          }
        },
      },
    ];
  }

  private openHealthReport(device: DeviceDto): void {
    this.healthReportRef = this.dialogService.open(DeviceHealthReport, {
      header: `Health Report${device?.Name ? ` - ${device.Name}` : ''}`,
      width: '70vw',
      modal: true,
      data: { device },
      dismissableMask: true,
      closable: true,
      breakpoints: {
        '960px': '90vw',
        '640px': '95vw',
      },
    });
  }

  public getAndDisplayApiKey(id: string): void {
    this.apiInfoRef = this.dialogService.open(DeviceApiInfo, {
      header: 'Device API Key',
      width: '450px',
      modal: true,
      data: { deviceId: id },
      dismissableMask: true,
      closable: true,
    });
  }

  public addDevice(): void {
    this.formRef = this.dialogService.open(DeviceForm, {
      header: 'Select a Device',
      width: '50vw',
      modal: true,
      breakpoints: {
        '960px': '75vw',
        '640px': '90vw',
      },
      closable: true,
    });

    this.formRef?.onClose.subscribe((device: DeviceDto | undefined) => {
      if (!device) return;

      this.deviceService.addDevice(device).subscribe({
        next: () => this.loadDevices(),
        error: (err) => console.error('Error adding device:', err),
      });
    });
  }

  public onRowMenuClick(event: MouseEvent, device: DeviceDto, menu: Menu): void {
    this.selectedDevice = device;
    menu.toggle(event);
  }

  private editDevice(device: DeviceDto): void {
    this.formRef = this.dialogService.open(DeviceForm, {
      header: 'Edit Device',
      width: '50vw',
      modal: true,
      data: device,
      dismissableMask: true,
      closable: true,
      breakpoints: {
        '960px': '75vw',
        '640px': '90vw',
      },
    });

    this.formRef?.onClose.subscribe((device: DeviceDto | undefined) => {
      if (!device) return;

      this.deviceService.updateDevice(device.Id, device).subscribe({
        next: () => this.loadDevices(),
        error: (err) => console.error('Error adding device:', err),
      });
    });
  }

  private deleteDevice(device: DeviceDto): void {
    if (!confirm('Are you sure you want to delete this device?')) {
      return;
    }

    this.deviceService.deleteDevice(device.Id).subscribe({
      next: () => {
        this.loadDevices();
      },
      error: (err) => {
        console.error('Error deleting device:', err);
      },
    });
  }
}
