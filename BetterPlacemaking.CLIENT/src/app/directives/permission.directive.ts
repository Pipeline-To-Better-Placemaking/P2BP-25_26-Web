import { Directive, Input, OnChanges, OnDestroy, TemplateRef, ViewContainerRef } from '@angular/core';
import { Subscription } from 'rxjs';
import { PermissionService } from '../services/permission-service';

@Directive({
  selector: '[hasPermission]',
  standalone: true,
})
export class PermissionDirective implements OnChanges, OnDestroy {
  @Input('hasPermission') public requiredPermission: string | string[] | null = null;
  @Input() public hasPermissionProjectId: string | null = null;
  @Input() public hasPermissionMode: 'all' | 'any' = 'all';

  private permissionSubscription: Subscription | null = null;
  private isVisible = false;

  public constructor(
    private readonly templateRef: TemplateRef<unknown>,
    private readonly viewContainer: ViewContainerRef,
    private readonly permissionService: PermissionService,
  ) {}

  public ngOnChanges(): void {
    this.bindPermissionCheck();
  }

  public ngOnDestroy(): void {
    this.permissionSubscription?.unsubscribe();
  }

  private bindPermissionCheck(): void {
    this.permissionSubscription?.unsubscribe();

    const required = this.requiredPermission;
    if (!required || (Array.isArray(required) && required.length === 0)) {
      this.setVisible(true);
      return;
    }

    const projectId = this.hasPermissionProjectId?.trim();

    const source$ = projectId
      ? this.permissionService.hasProjectPermission$(projectId, required, this.hasPermissionMode)
      : this.permissionService.hasGlobalPermission$(required, this.hasPermissionMode);

    this.permissionSubscription = source$.subscribe((allowed) => this.setVisible(allowed));
  }

  private setVisible(visible: boolean): void {
    if (visible === this.isVisible) {
      return;
    }

    this.isVisible = visible;
    this.viewContainer.clear();

    if (visible) {
      this.viewContainer.createEmbeddedView(this.templateRef);
    }
  }
}
