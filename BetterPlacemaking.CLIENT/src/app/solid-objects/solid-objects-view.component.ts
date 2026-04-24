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
import { HomographyService, GlobalHomographySetDto } from '../services/homography-service';
import {
  SolidObjectsSceneComponent,
  SolidObjectsTrackingPath,
} from './solid-objects-scene.component';

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
          <h3 class="mb-1.5 mt-2 text-sm text-slate-400">Tracking</h3>
          <p
            *ngIf="!uploadedFileName"
            class="my-1 text-sm leading-snug text-slate-500">
            No tracking data loaded. Upload positions from a hardware run.
          </p>
          <p
            *ngIf="uploadedFileName"
            class="my-1 text-sm leading-snug text-emerald-400">
            {{ trackingPaths.length }} path(s) from
            <strong class="font-medium text-slate-200">{{ uploadedFileName }}</strong>
          </p>

          <input
            #trackingFileInput
            type="file"
            accept=".csv,.json"
            class="hidden"
            (change)="onTrackingFileSelected($event)" />
          <button
            type="button"
            class="mt-1.5 w-full cursor-pointer rounded border-0 bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
            (click)="trackingFileInput.click()">
            Upload tracking data (.csv / .json)
          </button>
          <button
            type="button"
            *ngIf="uploadedFileName"
            class="mt-1.5 w-full cursor-pointer rounded border border-slate-600 bg-transparent px-3 py-1.5 text-sm text-slate-300 hover:border-slate-400 hover:text-slate-100"
            (click)="clearUploadedTracking()">
            Clear tracking
          </button>
          <p *ngIf="trackingError" class="mt-1.5 text-sm leading-snug text-red-400">
            {{ trackingError }}
          </p>
        </section>

        <section class="mb-4" *ngIf="calibrationMessage">
          <h3 class="mb-1.5 mt-2 text-sm text-slate-400">Alignment</h3>
          <p class="text-xs leading-snug text-slate-500">{{ calibrationMessage }}</p>
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
        [trackingPaths]="trackingPaths"
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

  /** Tracking paths parsed from a user-uploaded CSV/JSON, in scanner-meter coords. */
  rawTrackingPaths: SolidObjectsTrackingPath[] = [];
  trackingPaths: SolidObjectsTrackingPath[] = [];
  uploadedFileName: string | null = null;
  trackingError: string | null = null;
  calibrationMessage: string | null = null;
  private globalHomographies: GlobalHomographySetDto | null = null;
  private autoOffsetX = 0;
  private autoOffsetZ = 0;

  private metaPollSub?: Subscription;
  private lastRevisionSeen = 0;
  private metaPollPrimed = false;

  constructor(
    private rplidarService: RplidarScanService,
    private visualizerService: VisualizerService,
    private homographyService: HomographyService,
  ) {}

  ngOnInit(): void {
    this.loadGlobalCalibration();
    this.syncSolidTabAndPolling();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['projectContextId']) {
      this.loadGlobalCalibration();
      this.applyAlignmentToRawTracking();
    }
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

  // ─── Tracking upload ────────────────────────────────────────────────────────

  onTrackingFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Reset so re-uploading the same file still triggers (change).
    input.value = '';
    if (!file) return;

    this.trackingError = null;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const paths = file.name.toLowerCase().endsWith('.json')
          ? this.parseTracksJson(text)
          : this.parsePositionsCsv(text);
        if (paths.length === 0) {
          this.trackingError = 'No tracks parsed (need ≥ 2 points per track).';
          return;
        }
        this.rawTrackingPaths = paths;
        this.recomputeAutoAlignment();
        this.uploadedFileName = file.name;
      } catch (err) {
        console.error('Failed to parse tracking file:', err);
        this.trackingError = `Parse error: ${(err as Error).message}`;
      }
    };
    reader.onerror = () => {
      this.trackingError = 'Failed to read file.';
    };
    reader.readAsText(file);
  }

  clearUploadedTracking(): void {
    this.rawTrackingPaths = [];
    this.trackingPaths = [];
    this.uploadedFileName = null;
    this.trackingError = null;
    this.recomputeAutoAlignment();
  }

  /**
   * Parse a positions.csv from P2BP-25_26-Hardware: header row, then one row
   * per detection (`global_id, camera_id, frame_idx, timestamp_iso, x_ground,
   * y_ground, ...`). Coordinates are in cm and converted to m. Rows are
   * grouped by global_id and ordered by frame_idx.
   */
  private parsePositionsCsv(text: string): SolidObjectsTrackingPath[] {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
    const idx = (name: string) => header.indexOf(name);
    const iId = idx('global_id');
    const iFrame = idx('frame_idx');
    const iX = idx('x_ground');
    const iY = idx('y_ground');
    if (iId < 0 || iFrame < 0 || iX < 0 || iY < 0) {
      throw new Error(
        'CSV missing required columns (global_id, frame_idx, x_ground, y_ground).',
      );
    }

    const byId = new Map<string, { frame: number; x: number; y: number }[]>();
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      if (cols.length <= Math.max(iId, iFrame, iX, iY)) continue;
      const id = cols[iId].trim();
      const frame = parseInt(cols[iFrame], 10);
      const x = parseFloat(cols[iX]);
      const y = parseFloat(cols[iY]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(frame)) continue;
      const arr = byId.get(id) ?? [];
      arr.push({ frame, x, y });
      byId.set(id, arr);
    }

    return this.toTrackingPaths(byId);
  }

  /**
   * Parse a tracking JSON file. Two formats are supported:
   *
   * 1. Per-track files from `Data/tracks/` (array or single object), each with
   *    `global_id` and `positions: [[frame, ts, cx, cy, gx, gy], ...]` where
   *    gx/gy are camera ground-plane coords in **cm**.
   *
   * 2. Fused output from `FusionEngine` (`fused_tracks-*.json`): an object
   *    keyed by global_id, each value `{ sources, num_events, tracks: [{x, y,
   *    t, cam}, ...] }` where x/y are world coords in **mm** and t is unix ms.
   */
  private parseTracksJson(text: string): SolidObjectsTrackingPath[] {
    const parsed = JSON.parse(text);

    // Format 2: fused tracks object keyed by global_id.
    if (this.isFusedTracksObject(parsed)) {
      return this.parseFusedTracksObject(parsed);
    }

    // Format 1: per-track JSON (array of tracks or a single track).
    const tracks = Array.isArray(parsed) ? parsed : [parsed];

    const byId = new Map<string, { frame: number; x: number; y: number }[]>();
    for (const t of tracks) {
      const id = String(t?.global_id ?? `track-${byId.size}`);
      const positions = Array.isArray(t?.positions) ? t.positions : [];
      const arr: { frame: number; x: number; y: number }[] = [];
      for (const p of positions) {
        if (!Array.isArray(p) || p.length < 6) continue;
        const frame = Number(p[0]);
        const gx = Number(p[4]);
        const gy = Number(p[5]);
        if (!Number.isFinite(gx) || !Number.isFinite(gy) || !Number.isFinite(frame)) continue;
        arr.push({ frame, x: gx, y: gy });
      }
      if (arr.length > 0) byId.set(id, arr);
    }

    return this.toTrackingPaths(byId);
  }

  /** Heuristic: fused-tracks JSON is a plain object whose values have `tracks: []`. */
  private isFusedTracksObject(parsed: unknown): boolean {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    const values = Object.values(parsed as Record<string, unknown>);
    if (values.length === 0) return false;
    return values.every(
      (v) =>
        v != null &&
        typeof v === 'object' &&
        Array.isArray((v as { tracks?: unknown }).tracks),
    );
  }

  /**
   * Parse `FusionEngine` output. Coordinates are in **mm** and converted to m
   * directly here (the per-track grouping the CSV path needs is already done).
   */
  private parseFusedTracksObject(parsed: unknown): SolidObjectsTrackingPath[] {
    const colors = ['#22c55e', '#eab308', '#06b6d4', '#f472b6', '#a78bfa', '#34d399'];
    const result: SolidObjectsTrackingPath[] = [];
    const entries = Object.entries(parsed as Record<string, { tracks?: unknown[] }>);
    let i = 0;

    for (const [globalId, value] of entries) {
      const events = Array.isArray(value?.tracks) ? value.tracks : [];
      const sorted = events
        .map((e) => e as { x?: unknown; y?: unknown; t?: unknown })
        .filter(
          (e) =>
            Number.isFinite(Number(e.x)) &&
            Number.isFinite(Number(e.y)) &&
            Number.isFinite(Number(e.t)),
        )
        .map((e) => ({ x: Number(e.x), y: Number(e.y), t: Number(e.t) }))
        .sort((a, b) => a.t - b.t);

      if (sorted.length < 2) continue;

      result.push({
        id: `fused-${globalId}`,
        color: colors[i % colors.length],
        points: sorted.map((e) => ({ x: e.x / 1000, y: 0, z: e.y / 1000 })),
      });
      i++;
    }

    return result;
  }

  /**
   * Convert per-id frame-ordered cm points into scene paths. Camera ground
   * coords (x_ground, y_ground) map to scene floor coords (x, z); the scene
   * uses y as height and substitutes a default person height when y is 0.
   */
  private toTrackingPaths(
    byId: Map<string, { frame: number; x: number; y: number }[]>,
  ): SolidObjectsTrackingPath[] {
    const colors = ['#22c55e', '#eab308', '#06b6d4', '#f472b6', '#a78bfa', '#34d399'];
    const result: SolidObjectsTrackingPath[] = [];
    let i = 0;
    for (const [id, pts] of byId) {
      pts.sort((a, b) => a.frame - b.frame);
      const points = pts.map((p) => ({ x: p.x / 100, y: 0, z: p.y / 100 }));
      if (points.length < 2) continue;
      result.push({
        id: `upload-${id}`,
        color: colors[i % colors.length],
        points,
      });
      i++;
    }
    return result;
  }

  private applyAlignmentToRawTracking(): void {
    this.trackingPaths = this.rawTrackingPaths.map((path) => ({
      ...path,
      points: path.points.map((p) => {
        return {
          x: p.x + this.autoOffsetX,
          y: p.y,
          z: p.z + this.autoOffsetZ,
        };
      }),
    }));
  }

  private loadGlobalCalibration(): void {
    const projectId = this.projectContextId?.trim();
    this.globalHomographies = null;
    this.autoOffsetX = 0;
    this.autoOffsetZ = 0;
    if (!projectId) {
      this.calibrationMessage = 'Calibration unavailable: no project context.';
      return;
    }
    this.homographyService.getPuzzleWorkspace(projectId).subscribe({
      next: (workspace) => {
        this.globalHomographies = workspace.GlobalHomographies ?? null;
        this.recomputeAutoAlignment();
      },
      error: () => {
        this.globalHomographies = null;
        this.autoOffsetX = 0;
        this.autoOffsetZ = 0;
        this.calibrationMessage = 'Failed to load calibration records.';
        this.applyAlignmentToRawTracking();
      },
    });
  }

  private recomputeAutoAlignment(): void {
    if (!this.globalHomographies || this.rawTrackingPaths.length === 0) {
      this.autoOffsetX = 0;
      this.autoOffsetZ = 0;
      this.calibrationMessage = this.globalHomographies
        ? 'Upload tracking data to apply automatic calibration alignment.'
        : 'No saved global homography placements for this project.';
      this.applyAlignmentToRawTracking();
      return;
    }

    const calibrationCentroid = this.getCalibrationCentroidMeters(this.globalHomographies);
    const trackCentroid = this.getTrackCentroidMeters(this.rawTrackingPaths);
    if (!calibrationCentroid || !trackCentroid) {
      this.autoOffsetX = 0;
      this.autoOffsetZ = 0;
      this.calibrationMessage = 'Calibration loaded, but automatic alignment could not be derived.';
      this.applyAlignmentToRawTracking();
      return;
    }

    this.autoOffsetX = calibrationCentroid.x - trackCentroid.x;
    this.autoOffsetZ = calibrationCentroid.z - trackCentroid.z;
    this.calibrationMessage =
      `Automatic calibration alignment applied (X ${this.autoOffsetX.toFixed(2)}m, Z ${this.autoOffsetZ.toFixed(2)}m).`;
    this.applyAlignmentToRawTracking();
  }

  private getTrackCentroidMeters(paths: SolidObjectsTrackingPath[]): { x: number; z: number } | null {
    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    for (const path of paths) {
      for (const p of path.points) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) continue;
        sumX += p.x;
        sumZ += p.z;
        count++;
      }
    }
    if (count === 0) return null;
    return { x: sumX / count, z: sumZ / count };
  }

  /**
   * Convert camera placement centers from floorplan pixels into fused-world meters
   * using `OriginFp` and `MmPerFpPx`, then average.
   */
  private getCalibrationCentroidMeters(set: GlobalHomographySetDto): { x: number; z: number } | null {
    const origin = Array.isArray(set.OriginFp) && set.OriginFp.length >= 2 ? set.OriginFp : null;
    const mmPerPx = Number(set.MmPerFpPx);
    if (!origin || !Number.isFinite(mmPerPx) || mmPerPx <= 0) return null;
    const placements = Array.isArray(set.Placements) ? set.Placements : [];
    if (placements.length === 0) return null;

    let sumX = 0;
    let sumZ = 0;
    let count = 0;
    for (const p of placements) {
      const center = Array.isArray(p.CenterFp) && p.CenterFp.length >= 2 ? p.CenterFp : null;
      if (!center) continue;
      const fx = Number(center[0]);
      const fy = Number(center[1]);
      if (!Number.isFinite(fx) || !Number.isFinite(fy)) continue;
      const worldXmm = (fx - origin[0]) * mmPerPx;
      const worldYmm = (fy - origin[1]) * mmPerPx;
      sumX += worldXmm / 1000;
      sumZ += worldYmm / 1000;
      count++;
    }
    if (count === 0) return null;
    return { x: sumX / count, z: sumZ / count };
  }
}
