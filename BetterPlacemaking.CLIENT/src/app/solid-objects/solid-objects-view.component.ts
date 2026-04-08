import {
  Component,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  Input,
  ViewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription, interval, of } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { RplidarScanService, RplidarScanData } from '../services/rplidar-scan.service';
import { VisualizerService } from '../services/visualizer-service';
import { SolidObjectsSceneComponent } from './solid-objects-scene.component';

/**
 * Web Scanner: solid-object clusters for whatever point cloud is currently held by the
 * visualizer session (same source as the 3D view). No file picker or tracking overlay.
 */
@Component({
  selector: 'app-solid-objects-view',
  standalone: true,
  imports: [CommonModule, SolidObjectsSceneComponent],
  host: {
    class: 'block h-full w-full min-h-0',
  },
  template: `
    <div class="flex h-full min-h-0 w-full bg-[#0a0c10]">
      <aside
        class="w-[220px] min-w-[220px] shrink-0 overflow-y-auto border-r border-[#1e2433] bg-[#111318] p-3">
        <h2 class="mb-3 text-lg text-slate-200">2D View</h2>
        <section class="mb-4">
          <p class="mb-2 text-sm leading-snug text-slate-400">
            Same point cloud as the 3D View (session on the server).
          </p>
          <p *ngIf="loading" class="my-1 text-sm text-amber-500">Loading…</p>
          <p *ngIf="!loading && !scanData" class="my-1 text-sm leading-snug text-slate-500">
            No point cloud in this session. Load or upload data in the 3D View, then return to 2D
            View.
          </p>
        </section>
        <section class="mb-4" *ngIf="scanData">
          <h3 class="mb-1.5 mt-2 text-sm text-slate-400">Info</h3>
          <div class="my-1 text-sm text-slate-400">Clusters: {{ scanData.clusters.length }}</div>
          <div class="my-1 text-sm text-slate-400">Floor Z: {{ scanData.meta.FloorZ }} m</div>
        </section>
        <section class="mb-4">
          <button
            type="button"
            class="mt-1.5 cursor-pointer rounded border-0 bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            (click)="scene?.resetView()">
            Reset View
          </button>
        </section>
      </aside>
      <app-solid-objects-scene
        #scene
        [scanData]="scanData"
        [trackingPaths]="[]"
        class="min-h-[300px] min-w-[400px] flex-1">
      </app-solid-objects-scene>
    </div>
  `,
})
export class SolidObjectsViewComponent implements OnInit, OnChanges, OnDestroy {
  @ViewChild('scene') scene!: SolidObjectsSceneComponent;

  /** When true (2D View visible), reload from current visualizer session. */
  @Input() solidTabActive = false;

  /**
   * When set (Scanner embed), poll visualizer session revision so a new device scan replaces
   * clusters while this view stays open — same mechanism as the 3D View.
   */
  @Input() projectContextId?: string;

  scanData: RplidarScanData | null = null;
  loading = false;

  private metaPollSub?: Subscription;
  private lastRevisionSeen = 0;
  private metaPollPrimed = false;

  constructor(
    private rplidarService: RplidarScanService,
    private visualizerService: VisualizerService,
  ) {}

  ngOnInit(): void {
    this.syncSolidTabAndPolling();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['solidTabActive'] || changes['projectContextId']) {
      this.syncSolidTabAndPolling();
    }
  }

  ngOnDestroy(): void {
    this.stopMetaPolling();
  }

  /** Load clusters when tab is shown; poll revision when embedded so new scans refresh in place. */
  private syncSolidTabAndPolling(): void {
    if (this.solidTabActive) {
      this.loadFromCurrentPointCloud();
      this.startMetaPollingIfEmbedded();
    } else {
      this.stopMetaPolling();
    }
  }

  private shouldPollSession(): boolean {
    return !!this.projectContextId?.trim();
  }

  private startMetaPollingIfEmbedded(): void {
    if (!this.shouldPollSession()) {
      this.stopMetaPolling();
      return;
    }
    this.stopMetaPolling();
    this.metaPollPrimed = false;
    this.metaPollSub = interval(2800)
      .pipe(
        switchMap(() =>
          this.visualizerService.getPointsMeta().pipe(catchError(() => of(null))),
        ),
      )
      .subscribe((meta) => {
        if (!meta || !this.solidTabActive) {
          return;
        }
        if (!this.metaPollPrimed) {
          this.metaPollPrimed = true;
          this.lastRevisionSeen = meta.Revision;
          return;
        }
        if (meta.Revision > this.lastRevisionSeen) {
          this.lastRevisionSeen = meta.Revision;
          this.loadFromCurrentPointCloud();
        }
      });
  }

  private stopMetaPolling(): void {
    this.metaPollSub?.unsubscribe();
    this.metaPollSub = undefined;
  }

  private loadFromCurrentPointCloud(): void {
    this.loading = true;
    this.rplidarService.loadScanFromCurrentPointCloud().subscribe({
      next: (data) => {
        this.scanData = data;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
        this.scanData = null;
      },
    });
  }
}
