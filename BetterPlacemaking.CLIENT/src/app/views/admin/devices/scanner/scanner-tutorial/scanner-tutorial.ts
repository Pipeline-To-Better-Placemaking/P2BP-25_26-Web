import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  EventEmitter,
  HostListener,
  OnDestroy,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonModule } from 'primeng/button';

interface TutorialStep {
  title: string;
  description: string;
  targetElementId: string | null;
  visualMode?: 'solids' | '3d';
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const STEPS: TutorialStep[] = [
  {
    title: 'Welcome to the Lidar Scanning Dashboard',
    description: 'This is your 3D Model/Lidar Scanning Dashboard. Here, you can manage and visualize your project\'s Lidar scans.',
    targetElementId: null,
  },
  {
    title: 'Perform Scan',
    description: 'The Perform Scan button triggers a scan on all of the selected project\'s devices immediately. "Reset to Base" restores the default scan settings.',
    targetElementId: 'tutorial-header',
  },
  {
    title: 'Status Overview',
    description: 'These stat cards display necessary scan info. In order: Current Status of the active scan, Successful scan run count, Failed scan run count, and whether the project\'s LiDAR device is Connected or Offline.',
    targetElementId: 'tutorial-stats',
  },
  {
    title: 'Scan Settings',
    description: 'Here you can control the scan configuration. You can choose a quality preset or customize the individual fields via the dropdowns.',
    targetElementId: 'tutorial-scan-settings',
  },
  {
    title: 'Preset',
    description: 'Conveniently set all scan fields using Base, Medium, or High quality presets.',
    targetElementId: 'tutorial-preset',
  },
  {
    title: 'Scan Resolution',
    description: 'Set the resolution of the scan by selecting your preferred angle per slice. Higher values are more detailed but take longer. Lower values are faster.',
    targetElementId: 'tutorial-scan-resolution',
  },
  {
    title: 'Protocol Mode',
    description: 'Select your preferred protocol. Legacy is most compatible with older systems. Express is a good balance between system compatibility and data density. Dense is best for high-end systems and detailed scans. Ultra is most detailed but requires the latest hardware and software to process effectively.',
    targetElementId: 'tutorial-protocol-mode',
  },
  {
    title: 'Orientation Mode',
    description: 'The LiDAR can be used in different orientations. Select which one you are using it in. Note: Wall refers to handheld or tripod-mounted scans.',
    targetElementId: 'tutorial-orientation-mode',
  },
  {
    title: 'Output Mode',
    description: 'Choose what you would like to save from the scan\'s output. Filtered saves a .xyz with outliers filtered out and Raw saves the full unfiltered point cloud. You can save both as well.',
    targetElementId: 'tutorial-output-mode',
  },
  {
    title: 'Split Mode',
    description: 'Option to split the capture into front/back 180° segments, otherwise a single full sweep.',
    targetElementId: 'tutorial-split-mode',
  },
  {
    title: 'Capture Strategy',
    description: 'Pick a method of capturing: Fixed Time will give the scan a duration, Minimum Revolutions limits scan by setting the minimum number of revolutions of the LiDAR, and Hybrid does both.',
    targetElementId: 'tutorial-capture-strategy',
  },
  {
    title: 'Minimum Revolutions',
    description: 'Set the minimum number of rotations per slice. (Higher = denser data per slice).',
    targetElementId: 'tutorial-min-revolutions',
  },
  {
    title: 'Distance Filtering',
    description: 'Toggle this on to reduces noise from walls (or the LiDAR itself). Useful for handheld/tripod-mounted "Wall" orientation mode.',
    targetElementId: 'tutorial-filter',
  },
  {
    title: 'Recalibrate Before Scan',
    description: 'Toggling this on has the device recalibrate its sensors before starting this scan.',
    targetElementId: 'tutorial-recalibrate',
  },
  {
    title: 'Schedule Lidar Scan',
    description: 'You can preemptively set up a Lidar scan here by using the date/time picker and specifying the scan frequency (Weekly, Monthly, Yearly), and finally specifying an end date for recurring scans. The scheduled scans table below will display all of your upcoming scans.',
    targetElementId: 'tutorial-scheduling',
  },
  {
    title: 'Scan History',
    description: 'This is the history of all previous scans on the project. It imcludes the scan name, date, status, and quality. Scans can be exported as .xyz, .obj or .ply. You can also delete scans from the history.',
    targetElementId: 'tutorial-history',
  },
  {
    title: '2D / 3D View Toggle',
    description: 'Here you can toggle between the 2D and 3D visualization modes. The 3D point cloud viewer lets you to interact with the point cloud data, and the 2D solid objects view gives insight into detected clusters and floor plans.',
    targetElementId: 'tutorial-view-toggle',
  },
  {
    title: 'Visualization Area',
    description: 'The 3D point cloud viewer allows for upload and export functionalities in the form of .xyz (point cloud), .obj (mesh), and .ply. You can rotate/zoom/pan your uploaded files. You can also reset the view to the default orientation via the reset button.',
    targetElementId: 'tutorial-visualization',
    visualMode: '3d',
  },
  {
    title: '2D Solid Objects View',
    description: 'With the 2D view, you can toggle clusters\' visibility and floor plans using the checkboxes. The side bar displays information about the current scan; number of points, detected clusters, and floor level. You can also get more detailed information about individual clusters by clicking on them.',
    targetElementId: 'tutorial-2d-view',
    visualMode: 'solids',
  },
];

@Component({
  selector: 'app-scanner-tutorial',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  templateUrl: './scanner-tutorial.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerTutorialComponent implements AfterViewChecked, OnDestroy {
  @Output() done = new EventEmitter<void>();
  @Output() modeChange = new EventEmitter<'solids' | '3d'>();

  readonly steps = STEPS;
  currentIndex = 0;
  spotlight: SpotlightRect | null = null;
  tooltipStyle: Record<string, string> = {};

  private lastIndex = -1;
  private readonly resizeListener = () => this.positionSpotlight();

  constructor(private readonly cdr: ChangeDetectorRef) {
    window.addEventListener('resize', this.resizeListener);
  }

  ngAfterViewChecked(): void {
    if (this.currentIndex !== this.lastIndex) {
      this.lastIndex = this.currentIndex;
      setTimeout(() => {
        this.positionSpotlight();
        this.cdr.markForCheck();
      }, 80);
    }
  }

  ngOnDestroy(): void {
    window.removeEventListener('resize', this.resizeListener);
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.skip();
    if (e.key === 'ArrowRight' && this.currentIndex < this.steps.length - 1) this.next();
    if (e.key === 'ArrowLeft' && this.currentIndex > 0) this.prev();
  }

  get currentStep(): TutorialStep {
    return this.steps[this.currentIndex];
  }

  next(): void {
    if (this.currentIndex < this.steps.length - 1) this.currentIndex++;
  }

  prev(): void {
    if (this.currentIndex > 0) this.currentIndex--;
  }

  skip(): void {
    this.done.emit();
  }

  finish(): void {
    this.done.emit();
  }

  private positionSpotlight(): void {
    const step = this.steps[this.currentIndex];

    if (step.visualMode) {
      this.modeChange.emit(step.visualMode);
    }

    if (!step.targetElementId) {
      this.spotlight = null;
      this.tooltipStyle = {};
      return;
    }

    const el = document.getElementById(step.targetElementId);
    if (!el) {
      this.spotlight = null;
      return;
    }

    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    setTimeout(() => {
      const rect = el.getBoundingClientRect();
      const P = 8;
      this.spotlight = {
        top: rect.top - P,
        left: rect.left - P,
        width: rect.width + P * 2,
        height: rect.height + P * 2,
      };
      this.tooltipStyle = this.computeTooltipStyle(rect);
      this.cdr.markForCheck();
    }, 300);
  }

  private computeTooltipStyle(rect: DOMRect): Record<string, string> {
    const TH = 210;
    const TW = 380;
    const M = 16;
    const vH = window.innerHeight;
    const vW = window.innerWidth;

    let top: number;
    if (vH - rect.bottom >= TH + M) {
      top = rect.bottom + M + 8;
    } else if (rect.top >= TH + M) {
      top = rect.top - M - TH - 8;
    } else {
      top = (vH - TH) / 2;
    }

    const left = Math.min(Math.max(rect.left, M), vW - TW - M);
    return { top: `${top}px`, left: `${left}px`, width: `${TW}px` };
  }
}
