import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DeviceApiInfo } from './device-api-info';

describe('DeviceApiInfo', () => {
  let component: DeviceApiInfo;
  let fixture: ComponentFixture<DeviceApiInfo>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DeviceApiInfo]
    })
    .compileComponents();

    fixture = TestBed.createComponent(DeviceApiInfo);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
