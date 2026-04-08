import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { MessageService } from 'primeng/api';

import { Scanner } from './scanner';
import { DeviceService } from '../../../../services/device-service';
import { ScanService } from '../../../../services/scan-service';

describe('Scanner', () => {
  let component: Scanner;
  let fixture: ComponentFixture<Scanner>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Scanner],
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { paramMap: convertToParamMap({ projectId: 'test-project' }) },
            paramMap: of(convertToParamMap({ projectId: 'test-project' })),
            parent: undefined,
          },
        },
        { provide: DeviceService, useValue: { getDevices: () => of([]) } },
        {
          provide: ScanService,
          useValue: {
            startScan: () => of({ Id: '', Status: '' }),
            getSchedules: () => of([]),
            createSchedule: () => of({ Id: '' }),
            updateSchedule: () => of(void 0),
            deleteSchedule: () => of(void 0),
          },
        },
        MessageService,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Scanner);
    component = fixture.componentInstance;
    // Avoid fixture.detectChanges(): Point Cloud + 2D View both mount (display toggle) and
    // require WebGL; headless Karma often has no GL context.
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
