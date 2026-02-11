import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ProjectsList } from './projects-list';
import { ProjectService } from '../../../../services/project-service';

describe('ProjectsList', () => {
  let component: ProjectsList;
  let fixture: ComponentFixture<ProjectsList>;
  
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectsList],
      providers: [
        {
          provide: ProjectService,
          useValue: {
            getProjects: () => of([]),
          },
        },
      ],
    })
    .compileComponents();

    fixture = TestBed.createComponent(ProjectsList);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
