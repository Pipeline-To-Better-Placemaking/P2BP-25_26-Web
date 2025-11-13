import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

interface Camera {
  id: string;
  name: string;
  x: number;
  y: number;
  cluster: string;
  height: string;
  notes?: string;
}

interface RoomArea {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

@Component({
  selector: 'app-project-edit',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './project-edit.component.html',
  styleUrl: './project-edit.component.scss'
})
export class ProjectEditComponent {
  floorplanUrl = 'testfloorplan.png';

  rooms: RoomArea[] = [
    { id: 'main-gallery', x: 40, y: 5, width: 30, height: 85, color: 'rgba(74,222,128,0.4)' }, // green-400 @40%
    { id: 'small-gallery', x: 55, y: 85, width: 10, height: 15, color: 'rgba(248,113,113,0.5)' } // red-400 @50%
  ];

  cameras: Camera[] = [
    { id: 'c1', name: 'Camera 1', x: 42, y: 7, cluster: 'North Cluster', height: 'Camera 1' },
    { id: 'c2', name: 'Camera 2', x: 67, y: 7, cluster: 'North Cluster', height: 'Camera 1' },
    { id: 'c3', name: 'Camera 3', x: 42, y: 50, cluster: 'South Cluster', height: 'Camera 1' },
    { id: 'c4', name: 'Camera 4', x: 67, y: 50, cluster: 'South Cluster', height: 'Camera 1' },
    { id: 'c5', name: 'Camera 5', x: 42, y: 90, cluster: 'South Cluster', height: 'Camera 1' },
    { id: 'c6', name: 'Camera 6', x: 67, y: 90, cluster: 'South Cluster', height: 'Camera 1' },
    { id: 'c7', name: 'Camera 7', x: 55, y: 25, cluster: 'Center Cluster', height: 'Camera 1' },
    { id: 'c8', name: 'Camera 8', x: 55, y: 70, cluster: 'Center Cluster', height: 'Camera 1' }
  ];

  selectedCameraId: string | null = this.cameras[2].id; // preselect example

  // Form bound properties
  cameraName = this.getSelectedCamera().name;
  cameraHeight = this.getSelectedCamera().height;
  cameraCluster = this.getSelectedCamera().cluster;
  cameraNotes = '';

  getSelectedCamera(): Camera {
    return this.cameras.find(c => c.id === this.selectedCameraId) as Camera;
  }

  selectCamera(cam: Camera) {
    this.selectedCameraId = cam.id;
    this.cameraName = cam.name;
    this.cameraHeight = cam.height;
    this.cameraCluster = cam.cluster;
    this.cameraNotes = cam.notes || '';
  }

  saveCamera() {
    const cam = this.getSelectedCamera();
    cam.name = this.cameraName;
    cam.height = this.cameraHeight;
    cam.cluster = this.cameraCluster;
    cam.notes = this.cameraNotes;
    // Placeholder for persistence API call
    console.log('Saved camera', cam);
  }

  deleteCamera(cam: Camera) {
    this.cameras = this.cameras.filter(c => c.id !== cam.id);
    if (this.selectedCameraId === cam.id) {
      this.selectedCameraId = this.cameras.length ? this.cameras[0].id : null;
    }
  }
}
