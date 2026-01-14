import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeviceHealthReport } from './device-health-report';

describe('DeviceHealthReport', () => {
  let component: DeviceHealthReport;
  let fixture: ComponentFixture<DeviceHealthReport>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeviceHealthReport]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DeviceHealthReport);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
