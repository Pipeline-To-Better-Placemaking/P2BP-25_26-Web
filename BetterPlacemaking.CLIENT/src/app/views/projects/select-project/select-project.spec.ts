import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SelectProject } from './select-project';

describe('SelectProject', () => {
  let component: SelectProject;
  let fixture: ComponentFixture<SelectProject>;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectProject]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SelectProject);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
