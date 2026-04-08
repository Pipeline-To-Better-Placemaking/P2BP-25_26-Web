import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { DatePickerModule } from 'primeng/datepicker';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { FusionService } from '../../../../../services/fusion-service';
import { FusionRunDto } from '../../../../../models/FusionDtos';

@Component({
  selector: 'app-fusion-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    MessageModule,
    DatePickerModule,
  ],
  templateUrl: './fusion-modal.html',
})
export class FusionModal implements OnInit {
  fromDate: Date | null = null;
  toDate: Date | null = null;
  maxDate = new Date();

  submitting = false;
  error: string | null = null;

  constructor(
    private readonly config: DynamicDialogConfig,
    private readonly ref: DynamicDialogRef,
    private readonly fusionService: FusionService,
  ) {}

  ngOnInit(): void {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    this.fromDate = yesterday;
    this.toDate = new Date(today.getTime() - 1);
  }

  get canSubmit(): boolean {
    return !!this.fromDate && !!this.toDate && !this.submitting;
  }

  get dateRangeValid(): boolean {
    if (!this.fromDate || !this.toDate) return true;
    return this.fromDate.getTime() < this.toDate.getTime();
  }

  submit(): void {
    if (!this.fromDate || !this.toDate || !this.dateRangeValid) return;

    this.submitting = true;
    this.error = null;

    const fromUnix = this.fromDate.getTime() / 1000;
    const toUnix = this.toDate.getTime() / 1000;

    this.fusionService.triggerFusion({ fromDateUnix: fromUnix, toDateUnix: toUnix }).subscribe({
      next: (run: FusionRunDto) => {
        this.submitting = false;
        this.ref.close({ triggered: true, run });
      },
      error: () => {
        this.submitting = false;
        this.error = 'Failed to trigger fusion. Check server connectivity and try again.';
      },
    });
  }

  cancel(): void {
    this.ref.close({ triggered: false });
  }
}