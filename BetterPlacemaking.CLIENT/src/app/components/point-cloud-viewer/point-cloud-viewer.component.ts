import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { ButtonModule } from 'primeng/button';
import { SelectModule } from 'primeng/select';
import { MessageModule } from 'primeng/message';
import { VisualizerService, LidarPoint3D } from '../../services/visualizer-service';
import { ScanService } from '../../services/scan-service';
import { ActivatedRoute, ParamMap } from '@angular/router';
import { of } from 'rxjs';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { PermissionDirective } from '../../directives/permission.directive';

interface QualitySettings {
  downsample: number;
  maxPoints: number;
  pointSize: number;
}

interface ExportOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-point-cloud-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule, CardModule, ButtonModule, SelectModule, MessageModule, PermissionDirective],
  templateUrl: './point-cloud-viewer.component.html',
})
export class PointCloudViewerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('rendererCanvas', { static: false })
  canvasRef!: ElementRef<HTMLCanvasElement>;

  // ── State ──────────────────────────────────────────────────────────
  lidar3D: LidarPoint3D[] = [];
  currentFps = 0;
  uploadProgress = 0;
  statusMessage: string | null = null;
  statusSeverity: 'success' | 'error' | 'info' = 'info';
  selectedFile?: File;
  isLoading = false;
  /** Same as gallery-view <code>xyzUnits</code>; RPLidar .xyz is usually meters. */
  xyzUnits: 'mm' | 'm' = 'm';

  exportOptions: ExportOption[] = [
    { label: 'OBJ (Rhino)', value: 'obj' },
    { label: 'PLY (MeshLab)', value: 'ply' },
    { label: 'XYZ', value: 'xyz' },
    { label: 'XYZ + RGB', value: 'xyz-rgb' },
    { label: 'CSV', value: 'csv' },
    { label: 'TXT', value: 'txt' },
    { label: 'PTS', value: 'pts' },
  ];
  selectedExport: ExportOption | undefined;

  // ── Three.js internals ─────────────────────────────────────────────
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private animationFrameId?: number;
  private pointCloud?: THREE.Points;
  private meshObject?: THREE.Group;
  private objLoader = new OBJLoader();
  private pointCloudCenter = { x: 0, y: 0, z: 0 };
  private frameCount = 0;
  private lastFpsTime = 0;
  /** When embedded (e.g. 3D View on Scanner), parent passes route `projectId` for upload query params. */
  @Input() projectContextId?: string;
  private routeProjectId?: string;
  /**
   * Source currently shown in the viewer.
   * - auto: loaded from latest completed auto-uploaded scan via /visualizer/latest
   * - manual: loaded from ad-hoc file upload in this viewer
   */
  private activeSource: 'auto' | 'manual' = 'auto';

  constructor(
    private readonly visualizerService: VisualizerService,
    private readonly scanService: ScanService,
    private readonly route: ActivatedRoute
  ) {}

  // ── Lifecycle ──────────────────────────────────────────────────────

  ngOnInit(): void {
    const applyRouteProjectId = (params: ParamMap) => {
      const id = params.get('projectId');
      if (id) {
        this.routeProjectId = id;
      }
    };
    const parentId = this.route.parent?.snapshot.paramMap.get('projectId');
    const selfId = this.route.snapshot.paramMap.get('projectId');
    this.routeProjectId = (parentId || selfId) ?? undefined;

    this.route.parent?.paramMap.subscribe(applyRouteProjectId);
    this.route.paramMap.subscribe(applyRouteProjectId);
  }

  private effectiveProjectId(): string | undefined {
    return this.projectContextId?.trim() || this.routeProjectId;
  }

  public get permissionProjectId(): string | null {
    return this.effectiveProjectId() ?? null;
  }

  ngAfterViewInit(): void {
    // Small timeout to allow the DOM to fully settle before initialising WebGL
    setTimeout(() => {
      this.initThreeJS();
      // Always start from latest auto-uploaded scan for deterministic behavior.
      this.refreshPointCloud();
    }, 0);
  }

  ngOnDestroy(): void {
    if (this.animationFrameId != null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.renderer?.dispose();
  }

  // ── Three.js setup ─────────────────────────────────────────────────

  /** Ported from P2BP-25_26-Visualizer `gallery-view.component.ts` `initThreeJS` (fixed canvas buffer via width/height attrs). */
  private initThreeJS(): void {
    const canvas = this.canvasRef.nativeElement;
    const width = canvas.width;
    const height = canvas.height;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a1a);

    this.camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 50000);
    this.camera.position.set(500, 500, 500);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      precision: 'highp',
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = false;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.9));

    const directionalLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight1.position.set(500, 500, 500);
    this.scene.add(directionalLight1);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.6);
    directionalLight2.position.set(-500, 300, -500);
    this.scene.add(directionalLight2);

    const directionalLight3 = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight3.position.set(0, 1000, 0);
    this.scene.add(directionalLight3);

    this.scene.add(new THREE.GridHelper(2000, 20, 0x333333, 0x444444));
    this.scene.add(new THREE.AxesHelper(200));

    this.animate();
  }

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    this.frameCount++;
    const now = performance.now();
    if (now - this.lastFpsTime >= 1000) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsTime = now;
    }
  };

  // ── Data loading ───────────────────────────────────────────────────

  refreshPointCloud(): void {
    this.isLoading = true;
    this.clearScene();
    this.lidar3D = [];
    const pid = this.effectiveProjectId()?.trim();

    // When there's no project context we can't ask the server for the latest
    // auto-uploaded scan — just show whatever is currently in the session.
    if (!pid) {
      this.loadCurrentSessionPoints({ fallbackMessage: 'No point cloud data available.' });
      return;
    }

    this.scanService.loadLatestCompleteScanIntoVisualizer(pid).subscribe({
      next: (res) => {
        if (res.success) {
          // Server ingested the latest auto-uploaded scan into the session; render it.
          this.loadCurrentSessionPoints({
            onEmpty: () =>
              this.showStatus(
                'Server reported a loaded auto scan but returned no points. Try again or re-run the scan.',
                'error',
              ),
            onLoaded: (count) => {
              this.activeSource = 'auto';
              this.showStatus(`Loaded latest auto scan: ${count.toLocaleString()} points.`, 'success');
            },
          });
          return;
        }

        // Ingest failed. Surface the server's reason instead of the stale-session fallback,
        // and don't pretend we loaded an auto scan.
        this.isLoading = false;
        const reasonMessage = this.describeLatestScanFailure(res.reason, res.message);
        this.showStatus(reasonMessage, 'info');
      },
      error: () => {
        this.isLoading = false;
        this.showStatus('Failed to load latest auto-uploaded scan.', 'error');
      },
    });
  }

  /** Fetch `_currentPoints` from the server and render if non-empty. */
  private loadCurrentSessionPoints(opts: {
    fallbackMessage?: string;
    onEmpty?: () => void;
    onLoaded?: (count: number) => void;
  }): void {
    this.visualizerService.getPoints().subscribe({
      next: (points) => {
        this.isLoading = false;
        if (!points || points.length === 0) {
          this.lidar3D = [];
          if (opts.onEmpty) {
            opts.onEmpty();
          } else if (opts.fallbackMessage) {
            this.showStatus(opts.fallbackMessage, 'info');
          }
          return;
        }
        this.lidar3D = points;
        this.renderPointCloud();
        this.loadAndRenderMesh();
        if (opts.onLoaded) {
          opts.onLoaded(points.length);
        }
      },
      error: () => {
        this.isLoading = false;
        this.showStatus('Failed to refresh point cloud.', 'error');
      },
    });
  }

  /**
   * Human-readable explanation for why <c>POST /api/scan/{pid}/visualizer/latest</c>
   * did not ingest an auto-uploaded scan. Prefers the server's message when present.
   */
  private describeLatestScanFailure(reason?: string, message?: string): string {
    switch (reason) {
      case 'no_devices':
        return 'No scanner devices are assigned to this project yet.';
      case 'no_complete_scan':
        return 'No completed auto-uploaded scan found for this project yet.';
      case 'not_complete':
        return 'Latest scan is not marked complete.';
      case 'no_scan_id':
        return 'Latest scan record is missing an Id.';
      case 'xyz_not_found':
        return message || 'Latest scan .xyz could not be downloaded (ObjUrl expired or canonical Storage object is missing).';
      case 'no_points_parsed':
        return 'Latest scan .xyz contained no parseable points.';
      case 'file_too_large':
        return 'Latest scan .xyz exceeds the configured size limit.';
      case 'ingest_error':
        return 'Failed to ingest latest scan — see server logs.';
      default:
        return message || 'Could not load latest auto-uploaded scan.';
    }
  }

  // ── Quality (fixed: maximum — all points, no downsample cap) ───────

  private getQualitySettings(): QualitySettings {
    return { downsample: 1, maxPoints: 0, pointSize: 2.0 };
  }

  // ── File upload ────────────────────────────────────────────────────

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.selectedFile = input.files[0];
    }
  }

  uploadFile(): void {
    if (!this.selectedFile) return;

    const fileName = this.selectedFile.name.toLowerCase();
    this.uploadProgress = 10;
    this.isLoading = true;

    if (fileName.endsWith('.obj')) {
      this.uploadObj(this.selectedFile);
    } else if (fileName.endsWith('.xyz')) {
      this.uploadXyz(this.selectedFile);
    } else if (fileName.endsWith('.ply')) {
      this.uploadPly(this.selectedFile);
    } else {
      // Attempt as XYZ for other text-based formats (.txt, .pts)
      this.uploadXyz(this.selectedFile);
    }
  }

  private uploadObj(file: File): void {
    this.visualizerService.uploadObjFile(file, { projectId: this.effectiveProjectId() }).subscribe({
      next: (res) => {
        this.uploadProgress = 100;
        this.showStatus(
          `Uploaded ${file.name}: ${res.pointCloudCount.toLocaleString()} points extracted.`,
          'success',
        );
        this.refreshAfterUpload();
      },
      error: () => {
        this.uploadProgress = 0;
        this.isLoading = false;
        this.showStatus('Upload failed.', 'error');
      },
    });
  }

  private uploadXyz(file: File): void {
    this.visualizerService
      .uploadXyzFiles(file, undefined, { projectId: this.effectiveProjectId(), xyzUnits: this.xyzUnits })
      .subscribe({
      next: (res) => {
        this.uploadProgress = 100;
        this.showStatus(
          `Uploaded ${file.name}: ${res.pointCount.toLocaleString()} points loaded.`,
          'success',
        );
        this.refreshAfterUpload();
      },
      error: () => {
        this.uploadProgress = 0;
        this.isLoading = false;
        this.showStatus('Upload failed.', 'error');
      },
    });
  }

  private uploadPly(file: File): void {
    this.visualizerService.uploadPlyFile(file, 0, { projectId: this.effectiveProjectId() }).subscribe({
      next: (res) => {
        this.uploadProgress = 100;
        this.showStatus(
          `Uploaded ${file.name}: ${res.pointCount.toLocaleString()} points loaded.`,
          'success',
        );
        this.refreshAfterUpload();
      },
      error: () => {
        this.uploadProgress = 0;
        this.isLoading = false;
        this.showStatus('Upload failed.', 'error');
      },
    });
  }

  private refreshAfterUpload(): void {
    setTimeout(() => {
      this.visualizerService.getPoints().subscribe({
        next: (points) => {
          this.isLoading = false;
          this.uploadProgress = 0;
          if (!points || points.length === 0) return;
          this.lidar3D = points;
          this.activeSource = 'manual';
          this.clearScene();
          this.renderPointCloud();
          setTimeout(() => this.loadAndRenderMesh(), 500);
          this.showStatus(
            `Showing manual upload (${points.length.toLocaleString()} points). Press Refresh to return to latest auto scan.`,
            'info',
          );
        },
        error: () => {
          this.isLoading = false;
          this.uploadProgress = 0;
        },
      });
    }, 300);
  }

  // ── Export ──────────────────────────────────────────────────────────

  exportPointCloud(): void {
    if (!this.selectedExport) return;
    const format = this.selectedExport.value;

    this.visualizerService
      .exportPointCloud(format as 'obj' | 'csv' | 'xyz' | 'xyz-rgb' | 'txt' | 'pts' | 'ply')
      .subscribe({
        next: (content) => {
          const ext = format === 'xyz-rgb' ? 'xyz' : format;
          const blob = new Blob([content], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `pointcloud.${ext}`;
          a.click();
          URL.revokeObjectURL(url);
          this.showStatus(`Exported as ${format.toUpperCase()}.`, 'success');
        },
        error: () => {
          this.showStatus('Export failed. Make sure a point cloud is loaded.', 'error');
        },
      });
  }

  // ── Clear ──────────────────────────────────────────────────────────

  clearPointCloud(): void {
    this.visualizerService.clearPoints().subscribe({
      next: () => {
        this.lidar3D = [];
        this.clearScene();
        this.showStatus('Point cloud cleared.', 'info');
      },
      error: () => {
        this.showStatus('Failed to clear point cloud.', 'error');
      },
    });
  }

  // ── Rendering helpers ──────────────────────────────────────────────

  private clearScene(): void {
    // Remove all point clouds
    const toRemove: THREE.Object3D[] = [];
    this.scene.traverse((child: THREE.Object3D) => {
      if (child instanceof THREE.Points) {
        toRemove.push(child);
      }
    });
    toRemove.forEach((obj) => {
      this.scene.remove(obj);
      if (obj instanceof THREE.Points) {
        obj.geometry.dispose();
        if (obj.material) {
          (obj.material as THREE.Material).dispose();
        }
      }
    });

    if (this.pointCloud) {
      try {
        this.scene.remove(this.pointCloud);
        this.pointCloud.geometry.dispose();
        (this.pointCloud.material as THREE.Material).dispose();
      } catch {
        // already disposed
      }
      this.pointCloud = undefined;
    }

    // Remove mesh
    if (this.meshObject) {
      this.scene.remove(this.meshObject);
      this.meshObject.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mat = child.material;
          if (Array.isArray(mat)) {
            mat.forEach((m: THREE.Material) => m.dispose());
          } else if (mat) {
            mat.dispose();
          }
        }
      });
      this.meshObject = undefined;
    }
  }

  /**
   * Ported from P2BP-25_26-Visualizer `gallery-view.component.ts` `renderPointCloud`.
   * API points use PascalCase (`X`,`Y`,`Z`,`Color`,`Intensity`,`Classification`) per .NET JSON defaults.
   */
  private renderPointCloud(): void {
    if (this.lidar3D.length === 0) return;

    const positions = new Float32Array(this.lidar3D.length * 3);
    const colors = new Float32Array(this.lidar3D.length * 3);

    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;

    this.lidar3D.forEach((point) => {
      minX = Math.min(minX, point.X);
      maxX = Math.max(maxX, point.X);
      minY = Math.min(minY, point.Y);
      maxY = Math.max(maxY, point.Y);
      const z = point.Z || 0;
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    this.pointCloudCenter = { x: centerX, y: centerY, z: centerZ };

    this.lidar3D.forEach((point, i) => {
      positions[i * 3] = point.X - centerX;
      positions[i * 3 + 1] = (point.Z || 0) - centerZ;
      positions[i * 3 + 2] = point.Y - centerY;

      const color = new THREE.Color();
      if (point.Color && typeof point.Color === 'string' && point.Color.startsWith('#')) {
        try {
          const hexValue = point.Color.replace('#', '').trim();
          if (hexValue.length === 6) {
            color.setHex(parseInt(hexValue, 16));
          } else {
            throw new Error('Invalid hex length');
          }
        } catch {
          color.setRGB(0.5, 0.5, 0.5);
        }
      } else {
        const intensity = point.Intensity || 1.0;
        if (point.Classification === 0) {
          color.setRGB(0.5, 0.5, 0.5);
        } else if (point.Classification === 1) {
          color.setRGB(0.4, 0.4, 0.4);
        } else {
          color.setRGB(0.3, 0.3, 0.6);
        }
        color.multiplyScalar(intensity);
      }

      color.r = Math.min(1.0, Math.max(0, color.r));
      color.g = Math.min(1.0, Math.max(0, color.g));
      color.b = Math.min(1.0, Math.max(0, color.b));

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    });

    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    const maxSize = Math.max(sizeX, sizeY, sizeZ);

    const threeCenterX = 0;
    const threeCenterY = 0;
    const threeCenterZ = 0;

    const distance = Math.max(maxSize * 2, 1000);
    this.camera.position.set(
      threeCenterX + distance * 0.7,
      threeCenterY + distance * 0.5,
      threeCenterZ + distance * 0.7,
    );
    this.camera.lookAt(threeCenterX, threeCenterY, threeCenterZ);
    this.controls.target.set(threeCenterX, threeCenterY, threeCenterZ);
    this.controls.update();

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const pointCount = this.lidar3D.length;
    const qualitySettings = this.getQualitySettings();
    const baseSize = qualitySettings.pointSize;
    const densityFactor = Math.max(0.8, Math.min(2.0, Math.sqrt(100000 / pointCount)));
    const sizeFactor = Math.max(0.8, Math.min(1.5, maxSize / 800));
    const cameraDistance = this.camera.position.distanceTo(
      new THREE.Vector3(threeCenterX, threeCenterY, threeCenterZ),
    );
    const lodFactor = Math.max(0.7, Math.min(1.3, 800 / cameraDistance));
    const pointSize = Math.max(2.0, Math.min(8.0, baseSize * densityFactor * sizeFactor * lodFactor));

    const gradCanvas = document.createElement('canvas');
    gradCanvas.width = 64;
    gradCanvas.height = 64;
    const ctx = gradCanvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(255, 255, 255, 1.0)');
    gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.9)');
    gradient.addColorStop(0.8, 'rgba(255, 255, 255, 0.5)');
    gradient.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const pointTexture = new THREE.CanvasTexture(gradCanvas);
    pointTexture.needsUpdate = true;

    const material = new THREE.PointsMaterial({
      size: pointSize,
      vertexColors: true,
      sizeAttenuation: true,
      map: pointTexture,
      alphaTest: 0.01,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      fog: false,
      blending: THREE.NormalBlending,
    });

    this.pointCloud = new THREE.Points(geometry, material);
    this.scene.add(this.pointCloud);
  }

  private loadAndRenderMesh(): void {
    if (this.meshObject) {
      this.scene.remove(this.meshObject);
      this.meshObject.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const mat = child.material;
          if (Array.isArray(mat)) {
            mat.forEach((m: THREE.Material) => m.dispose());
          } else if (mat) {
            mat.dispose();
          }
        }
      });
      this.meshObject = undefined;
    }

    this.visualizerService.getMesh().subscribe({
      next: (objContent: string) => {
        if (!objContent || objContent.trim().length === 0) return;

        const faceCount = (objContent.match(/^f /gm) || []).length;
        if (faceCount === 0) {
          // No faces – keep point cloud visible
          if (this.pointCloud) {
            this.pointCloud.visible = true;
          }
          return;
        }

        try {
          const blob = new Blob([objContent], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);

          this.objLoader.load(
            url,
            (object: THREE.Group) => {
              const box = new THREE.Box3().setFromObject(object);
              const center = box.getCenter(new THREE.Vector3());
              object.position.sub(center);

              // Parse vertex colors from OBJ
              const vertexColors = new Map<number, [number, number, number]>();
              let vIdx = 0;
              for (const line of objContent.split('\n')) {
                const t = line.trim();
                if (t.startsWith('v ') && !t.startsWith('vn ') && !t.startsWith('vt ')) {
                  const parts = t.split(/\s+/);
                  if (parts.length >= 7) {
                    vertexColors.set(vIdx, [
                      parseFloat(parts[4]),
                      parseFloat(parts[5]),
                      parseFloat(parts[6]),
                    ]);
                  }
                  vIdx++;
                }
              }

              object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  let hasColors =
                    child.geometry?.attributes?.['color']?.count > 0;

                  if (!hasColors && vertexColors.size > 0 && child.geometry) {
                    const posAttr = child.geometry.attributes['position'];
                    if (posAttr) {
                      const colorArr = new Float32Array(posAttr.count * 3);
                      for (let i = 0; i < posAttr.count; i++) {
                        const c = vertexColors.get(i) ?? [0.5, 0.5, 0.5];
                        colorArr[i * 3] = c[0];
                        colorArr[i * 3 + 1] = c[1];
                        colorArr[i * 3 + 2] = c[2];
                      }
                      child.geometry.setAttribute(
                        'color',
                        new THREE.Float32BufferAttribute(colorArr, 3),
                      );
                      hasColors = true;
                    }
                  }

                  child.material = new THREE.MeshStandardMaterial({
                    color: hasColors ? 0xffffff : 0x888888,
                    flatShading: false,
                    side: THREE.DoubleSide,
                    metalness: 0.1,
                    roughness: 0.7,
                    transparent: false,
                    opacity: 1.0,
                    wireframe: false,
                    vertexColors: hasColors,
                  });

                  if (child.geometry) {
                    child.geometry.computeVertexNormals();
                  }
                }
              });

              this.meshObject = object;
              this.scene.add(object);

              // Keep point cloud visible – mesh is supplementary
              if (this.pointCloud) {
                this.pointCloud.visible = true;
              }
              // Hide mesh by default (Delaunay triangulation can obscure details)
              object.visible = false;

              URL.revokeObjectURL(url);
            },
            undefined,
            () => {
              if (this.pointCloud) {
                this.pointCloud.visible = true;
              }
              URL.revokeObjectURL(url);
            },
          );
        } catch {
          if (this.pointCloud) {
            this.pointCloud.visible = true;
          }
        }
      },
      error: () => {
        // Mesh not available – that's fine
        if (this.pointCloud) {
          this.pointCloud.visible = true;
        }
      },
    });
  }

  // ── Helpers ────────────────────────────────────────────────────────

  private showStatus(message: string, severity: 'success' | 'error' | 'info'): void {
    this.statusMessage = message;
    this.statusSeverity = severity;
    setTimeout(() => {
      this.statusMessage = null;
    }, 5000);
  }
}
