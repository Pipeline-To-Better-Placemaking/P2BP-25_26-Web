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
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const STEPS: TutorialStep[] = [
  {
    title: 'Welcome to the Vision Dashboard',
    description: 'This is your calibration control center. Let\'s walk through each section so you know exactly what to do to get your cameras ready for people tracking.',
    targetElementId: null,
  },
  {
    title: 'Calibration Snapshot',
    description: 'These cards show real-time progress across all cameras: how many have intrinsics calibrated, homographies computed, and ArUco lock complete. Green means done, red means action needed.',
    targetElementId: 'tutorial-stat-bar',
  },
  {
    title: 'Cameras',
    description: 'Each card represents one camera. Click it to open per-camera calibration. The I / H / A badges show Intrinsics, Homography, and ArUco lock status. Green is complete, grey is not yet done.',
    targetElementId: 'tutorial-cameras-panel',
  },
  {
    title: 'Board Library',
    description: 'Generate and save printable ChArUco or ArUco calibration boards here. During intrinsics and homography calibration you\'ll need a ChArUco board in front of each camera. During ArUco lock, you\'ll need multiple ArUco markers placed in overlapping views between cameras.',
    targetElementId: 'tutorial-board-library',
  },
  {
    title: 'Devices',
    description: 'Jetson devices host your cameras. Open a device to trigger the ArUco lock scan. This requires placing physical ArUco markers in overlapping camera views to align cameras into a shared coordinate space.',
    targetElementId: 'tutorial-devices-panel',
  },
  {
    title: 'Floorplan Library',
    description: 'Upload your environment\'s floor plan image here. Select one to use as the background in the Puzzle workspace where you\'ll align camera views to real-world coordinates.',
    targetElementId: 'tutorial-floorplan-library',
  },
  {
    title: 'Top-Down Map View',
    description: 'Once all cameras have homography scans, open the Puzzle Workspace to drag camera layers onto the floor plan. This produces global homographies used by the Fusion pipeline to track people across cameras.',
    targetElementId: 'tutorial-topdown-map',
  },
];

@Component({
  selector: 'app-vision-tutorial',
  standalone: true,
  imports: [CommonModule, ButtonModule],
  templateUrl: './vision-tutorial.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisionTutorialComponent implements AfterViewChecked, OnDestroy {
  @Output() done = new EventEmitter<void>();

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
