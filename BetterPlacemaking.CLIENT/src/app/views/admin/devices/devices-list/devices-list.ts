import { Component } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { MenuModule } from 'primeng/menu';
import { Device } from '../../../../models/Device';
import { DeviceService } from '../../../../services/device-service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { DeviceForm } from '../device-form/device-form';
import { MenuItem } from 'primeng/api';
import { Menu } from 'primeng/menu';

@Component({
  selector: 'app-devices-list',
  imports: [TableModule, ButtonModule, MenuModule],
  providers: [DialogService],
  templateUrl: './devices-list.html',
  styleUrl: './devices-list.scss',
})
export class DevicesList {
  public devices: Device[] = [];

  public rowMenuItems: MenuItem[] = [];
  private selectedDevice: Device | null = null;

  ref: DynamicDialogRef<DeviceForm> | null = null;

  public constructor(private deviceService: DeviceService, private dialogService: DialogService) {}

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
        label: 'Delete',
        icon: 'pi pi-trash',
        command: () => {
          if (this.selectedDevice) {
            this.deleteDevice(this.selectedDevice);
          }
        },
      },
    ];
  }
  
  public addDevice(): void {
    this.ref = this.dialogService.open(DeviceForm, {
      header: 'Select a Device',
      width: '50vw',
      modal: true,
      breakpoints: {
        '960px': '75vw',
        '640px': '90vw',
      },
      closable: true,
    });

    this.ref?.onClose.subscribe((device: Device | undefined) => {
      if (!device) {
        return;
      }

      this.deviceService.addDevice(device).subscribe({
        next: () => this.loadDevices(),
        error: (err) => console.error('Error adding device:', err),
      });
    });
  }


  public onRowMenuClick(event: MouseEvent, device: Device, menu: Menu): void {
    this.selectedDevice = device;
    menu.toggle(event);
  }

  private editDevice(device: Device): void {
    this.ref = this.dialogService.open(DeviceForm, {
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
  }

  private deleteDevice(device: Device): void {
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
