import {
  Component,
  ElementRef,
  ViewChild,
  AfterViewInit,
  OnDestroy,
  OnChanges,
  SimpleChanges,
  Input,
} from '@angular/core';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RplidarScanData } from '../services/rplidar-scan.service';

/** Tracking path overlay in solid objects scene (meters, scanner origin — same as RplidarScanData). */
export interface SolidObjectsTrackingPath {
  id?: string;
  points: { x: number; y: number; z: number }[];
  color?: string;
}

@Component({
  selector: 'app-solid-objects-scene',
  standalone: true,
  host: {
    class: 'block h-full min-h-[200px] w-full',
  },
  template: `
    <div
      #viewport
      class="relative h-full min-h-[200px] w-full overflow-hidden bg-[#0a0c10]">
      <canvas #solidCanvas class="block h-full w-full"></canvas>
    </div>
  `,
})
export class SolidObjectsSceneComponent implements AfterViewInit, OnDestroy, OnChanges {
  @ViewChild('viewport') viewportRef!: ElementRef<HTMLDivElement>;
  @ViewChild('solidCanvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  @Input() scanData: RplidarScanData | null = null;
  @Input() trackingPaths: SolidObjectsTrackingPath[] = [];

  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private controls!: OrbitControls;
  private meshGroup = new THREE.Group();
  private trackingGroup = new THREE.Group();
  private gridHelper!: THREE.GridHelper;
  private animationFrameId?: number;
  private disposed = false;
  private resizeObserver?: ResizeObserver;
  private lastWidth = 0;
  private lastHeight = 0;

  ngAfterViewInit(): void {
    const canvasEl = this.canvasRef?.nativeElement;
    const viewportEl = this.viewportRef?.nativeElement;
    if (!canvasEl || !viewportEl) return;

    this.renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x0a0c10);
    this.scene = new THREE.Scene();

    const w = Math.max(1, canvasEl.clientWidth || 800);
    const h = Math.max(1, canvasEl.clientHeight || 600);
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 500);
    this.camera.position.set(5, 5, 5);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, canvasEl);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(0, 0, 0);

    this.gridHelper = new THREE.GridHelper(20, 20, 0x2a3548, 0x1e2433);
    this.scene.add(this.gridHelper);
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 15, 10);
    dir.castShadow = false;
    this.scene.add(dir);
    this.scene.add(this.meshGroup);
    this.scene.add(this.trackingGroup);

    window.addEventListener('resize', () => this.onResize());
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(viewportEl);
    this.onResize();
    this.buildMeshesFromScan();
    this.buildTrackingOverlay();
    this.animate();
    requestAnimationFrame(() => this.onResize());
    setTimeout(() => this.onResize(), 200);
    setTimeout(() => this.onResize(), 500);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['scanData'] && this.meshGroup && !this.disposed) {
      this.buildMeshesFromScan();
      requestAnimationFrame(() => this.onResize());
    }
    if (changes['trackingPaths'] && this.trackingGroup && !this.disposed) {
      this.buildTrackingOverlay();
    }
  }

  ngOnDestroy(): void {
    this.disposed = true;
    if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
    window.removeEventListener('resize', () => this.onResize());
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
  }

  resetView(): void {
    if (!this.camera || !this.controls) return;
    this.camera.position.set(5, 5, 5);
    this.controls.target.set(0, 0, 0);
  }

  private animate = (): void => {
    if (this.disposed || !this.renderer || !this.scene || !this.camera) return;
    this.animationFrameId = requestAnimationFrame(this.animate);
    const el = this.canvasRef?.nativeElement;
    if (el && (el.clientWidth !== this.lastWidth || el.clientHeight !== this.lastHeight)) {
      this.onResize();
    }
    this.controls?.update();
    this.renderer?.render(this.scene, this.camera);
  };

  private onResize(): void {
    const el = this.canvasRef?.nativeElement;
    if (!el) return;
    const cw = el.clientWidth || 0;
    const ch = el.clientHeight || 0;
    const w = cw > 0 ? cw : 800;
    const h = ch > 0 ? ch : 600;
    if (w === this.lastWidth && h === this.lastHeight) return;
    this.lastWidth = w;
    this.lastHeight = h;
    this.renderer?.setSize(w, h);
    this.renderer?.setPixelRatio(window.devicePixelRatio);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
  }

  private buildMeshesFromScan(): void {
    while (this.meshGroup.children.length) this.meshGroup.remove(this.meshGroup.children[0]);
    if (!this.scanData || !this.scanData.clusters?.length) return;

    const color = 0x60a5fa;

    for (const c of this.scanData.clusters) {
      if (c.PointCount < 2) continue;
      const width = Math.max(0.1, c.MaxX - c.MinX);
      const depth = Math.max(0.1, c.MaxY - c.MinY);
      const height = Math.max(0.1, c.MaxHeight);
      const geometry = new THREE.BoxGeometry(width, height, depth);
      const material = new THREE.MeshStandardMaterial({ color, flatShading: true });
      const mesh = new THREE.Mesh(geometry, material);
      const centerX = (c.MinX + c.MaxX) / 2;
      const centerY = (c.MinY + c.MaxY) / 2;
      mesh.position.set(centerX, height / 2, centerY);
      this.meshGroup.add(mesh);
    }
  }

  private buildTrackingOverlay(): void {
    while (this.trackingGroup.children.length) {
      this.trackingGroup.remove(this.trackingGroup.children[0]);
    }
    const paths = this.trackingPaths ?? [];
    const personHeight = 0.2;
    const pathColors = [0x22c55e, 0xeab308, 0x06b6d4];

    for (let i = 0; i < paths.length; i++) {
      const track = paths[i];
      if (!track.points || track.points.length < 2) continue;

      const colorHex = track.color
        ? parseInt(track.color.replace('#', ''), 16)
        : pathColors[i % pathColors.length];
      const color = new THREE.Color(colorHex);

      const points = track.points.map(
        (p) =>
          new THREE.Vector3(
            p.x,
            p.y !== undefined && p.y !== 0 ? p.y : personHeight,
            p.z
          )
      );
      const curve = new THREE.CatmullRomCurve3(points);
      const curvePoints = curve.getPoints(80);
      const lineGeo = new THREE.BufferGeometry().setFromPoints(curvePoints);
      const lineMat = new THREE.LineBasicMaterial({ color, linewidth: 2 });
      const line = new THREE.Line(lineGeo, lineMat);
      this.trackingGroup.add(line);

      const step = Math.max(1, Math.floor(track.points.length / 12));
      for (let j = 0; j < track.points.length; j += step) {
        const p = track.points[j];
        const sphereGeo = new THREE.SphereGeometry(0.08, 10, 10);
        const sphereMat = new THREE.MeshBasicMaterial({ color });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        sphere.position.set(
          p.x,
          p.y !== undefined && p.y !== 0 ? p.y : personHeight,
          p.z
        );
        this.trackingGroup.add(sphere);
      }
      const last = track.points[track.points.length - 1];
      const endSphereGeo = new THREE.SphereGeometry(0.15, 12, 12);
      const endSphereMat = new THREE.MeshBasicMaterial({ color });
      const endSphere = new THREE.Mesh(endSphereGeo, endSphereMat);
      endSphere.position.set(
        last.x,
        last.y !== undefined && last.y !== 0 ? last.y : personHeight,
        last.z
      );
      this.trackingGroup.add(endSphere);
    }
  }
}
