import { ComponentFixture, TestBed } from '@angular/core/testing';

import { MultiLidarCalibration } from './multi-lidar-calibration';

describe('MultiLidarCalibration', () => {
  let component: MultiLidarCalibration;
  let fixture: ComponentFixture<MultiLidarCalibration>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MultiLidarCalibration]
    })
    .compileComponents();

    fixture = TestBed.createComponent(MultiLidarCalibration);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
