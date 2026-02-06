import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { PanelModule } from 'primeng/panel';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ProjectDto } from '../../../../models/ProjectDto';

@Component({
  selector: 'app-project-form',
  imports: [CommonModule, ReactiveFormsModule, ButtonModule, InputTextModule, InputNumberModule, PanelModule],
  templateUrl: './project-form.html',
  styleUrl: './project-form.scss',
})
export class ProjectForm implements OnInit {
  form!: FormGroup;

  @Input() project: ProjectDto | null = null;
  @Output() projectChange = new EventEmitter<ProjectDto>();

  private originalProject: ProjectDto | null = null;

  public constructor(
    private readonly fb: FormBuilder,
    private readonly ref: DynamicDialogRef,
    private readonly config: DynamicDialogConfig,
  ) {}

  ngOnInit(): void {
    const existing = this.project ?? (this.config.data as ProjectDto | undefined);
    this.originalProject = existing ?? null;

    this.form = this.fb.group({
      Id: [{ value: existing?.Id ?? '', disabled: true }],
      Title: [existing?.Title ?? '', [Validators.required]],
      Description: [existing?.Description ?? ''],
      Location: [existing?.Location ?? ''],
      Size: [existing?.Size ?? 0, [Validators.required, Validators.min(0)]],
    });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const raw = this.form.getRawValue() as {
      Id: string;
      Title: string;
      Description: string;
      Location: string;
      Size: number;
    };

    const project: ProjectDto = {
      ...this.originalProject,
      Id: this.originalProject?.Id ?? raw.Id ?? '',
      Title: raw.Title,
      Description: raw.Description,
      Location: raw.Location,
      Size: raw.Size ?? 0,
    };

    this.projectChange.emit(project);
    this.ref.close(project);
  }

  onCancel(): void {
    this.ref.close();
  }
}
