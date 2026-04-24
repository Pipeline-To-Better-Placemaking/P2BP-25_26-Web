import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterModule, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { Menu, MenuModule } from 'primeng/menu';
import { FontAwesomeModule, FaIconLibrary } from '@fortawesome/angular-fontawesome';
import {
  faFolder,
  faChartLine,
  faMoon,
  faSun,
  faUser,
  faCube,
  faEye,
  faCodeMerge,
  faPenToSquare,
  faUserShield,
  faFolderOpen,
  faMicrochip,
  faDownload,
} from '@fortawesome/free-solid-svg-icons';
import { MenuItem } from 'primeng/api';
import { ThemeService } from '../../services/theme-service';
import { ProjectService } from '../../services/project-service';
import { filter, startWith, Subscription } from 'rxjs';
import { NgIf } from '@angular/common';
import { AuthService } from '../../services/auth-service';
import { DialogService, DynamicDialogRef } from 'primeng/dynamicdialog';
import { ExportModal } from '../../views/projects/selected/export-modal/export-modal';
import { PermissionDirective } from '../../directives/permission.directive';

type PermissionMenuItem = MenuItem & {
  permission?: string | string[];
  permissionProjectId?: string | null;
  permissionMode?: 'all' | 'any';
  items?: PermissionMenuItem[];
};

@Component({
  selector: 'app-default-layout',
  standalone: true,
  imports: [RouterOutlet, ButtonModule, AvatarModule, MenuModule, RouterModule, FontAwesomeModule, NgIf, PermissionDirective],
  providers: [DialogService],
  templateUrl: './default-layout.html',
  styleUrl: './default-layout.scss',
})

export class DefaultLayout implements OnInit, OnDestroy {
  private projectId?: string;
  private routerSub?: Subscription;
  private exportDialogRef?: DynamicDialogRef;

  public readonly projectSectionPermissions = [
    'Project.Read',
    'Project.Scans.Read',
    'Project.Vision.Read',
    'Project.Devices.Read',
    'Project.Export',
    'Project.Members.AssignEditorViewer',
  ];

  public readonly adminSectionPermissions = [
    'Global.Users.Read',
    'Global.Projects.ReadAll',
  ];

  public readonly faMoon = faMoon;
  public readonly faUser = faUser;

  public currentProjectName: string | null = null;

  constructor(
    public themeService: ThemeService,
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService,
    private projectService: ProjectService,
    private dialogService: DialogService,
  ) {}

  navItems: PermissionMenuItem[] = [];

  navItemsIfSelected: PermissionMenuItem[] = [];

  navItemsAdmin: PermissionMenuItem[] = [];

  footerItems: MenuItem[] = [];
  userMenuItems: MenuItem[] = [];

  public get selectedProjectId(): string | null {
    return this.projectId ?? null;
  }

  @ViewChild('userMenu') private userMenu?: Menu;

  ngOnInit(): void {
    this.buildFooterItems();
    this.buildUserMenuItems();
    this.buildProjectSelectorNav();

    // Listen for navigation end events and rebuild menus when project id changes
    this.routerSub = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd), startWith(null))
      .subscribe(() => {
        const newId = this.getProjectIdFromRoute(this.route);
        const changed = newId !== this.projectId;
        this.projectId = newId;
        this.buildNavMenus(this.projectId);
        this.buildUserMenuItems(this.projectId);
        this.buildProjectSelectorNav(this.projectId);

        if (newId && changed) {
          this.projectService.getProject(newId).subscribe({
            next: (project) => this.currentProjectName = project.Title || null,
            error: () => this.currentProjectName = null,
          });
        } else if (!newId) {
          this.currentProjectName = null;
        }
      });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
  }

  private getProjectIdFromRoute(root: ActivatedRoute): string | undefined {
    let cursor: ActivatedRoute | null = root;
    while (cursor?.firstChild)
      cursor = cursor.firstChild;

    while (cursor) {
      const raw = cursor.snapshot.paramMap.get('projectId');
      if (raw != null) {
        const trimmed = raw.trim();
        return trimmed.length > 0 ? trimmed : undefined;
      }
      cursor = cursor.parent;
    }

    return undefined;
  }

  private buildNavMenus(projectId?: string): void {

    if (projectId != null && projectId !== '') {
      const base = projectId;
      this.navItemsIfSelected = [
        {
          label: 'Project',
          items: [
            { label: 'Dashboard', faIcon: faChartLine, routerLink: `/${base}/dashboard`, permission: 'Project.Read', permissionProjectId: base },
            { label: '3D Model', faIcon: faCube, routerLink: `/${base}/model`, permission: 'Project.Scans.Read', permissionProjectId: base },
            { label: 'Vision', faIcon: faEye, routerLink: `/${base}/vision`, permission: 'Project.Vision.Read', permissionProjectId: base },
            { label: 'Fusion', faIcon: faCodeMerge, routerLink: `/${base}/fusion`, permission: 'Project.Scans.Read', permissionProjectId: base },
            { label: 'Permissions', faIcon: faUserShield, routerLink: `/${base}/admin/permissions`, permission: 'Project.Members.AssignEditorViewer', permissionProjectId: base },
            { label: 'Devices', faIcon: faMicrochip, routerLink: `/${base}/devices`, permission: 'Project.Devices.Read', permissionProjectId: base },
            { label: 'Export Data', faIcon: faDownload, command: () => this.exportProjectData(), permission: 'Project.Export', permissionProjectId: base },
          ],
        },
      ];
      this.navItemsAdmin = [
        {
          label: 'Admin',
          items: [
            { label: 'Users', faIcon: faUserShield, routerLink: `/${base}/admin/users`, permission: 'Global.Users.Read' },
            { label: 'Manage Projects', faIcon: faFolderOpen, routerLink: `/${base}/admin/projects`, permission: 'Global.Projects.ReadAll' },
          ],
        },
      ];
    } else {
      this.navItemsIfSelected = [
      ];
      this.navItemsAdmin = [
        {
          label: 'Admin',
          items: [
            { label: 'Users', faIcon: faUserShield, routerLink: '/admin/users', permission: 'Global.Users.Read' },
            { label: 'Manage Projects', faIcon: faFolderOpen, routerLink: '/admin/projects', permission: 'Global.Projects.ReadAll' },
          ],
        },
      ];
    }
  }

  private buildProjectSelectorNav(projectId?: string): void {
    const link = projectId ? `/${projectId}/projects` : '/projects';
    this.navItems = [{ label: 'Select Project', faIcon: faFolder, routerLink: link }];
  }

  private buildUserMenuItems(projectId?: string): void {
    const settingsLink = projectId ? `/${projectId}/user-settings` : '/user-settings';
    this.userMenuItems = [
      { label: 'Settings', icon: 'pi pi-cog', command: () => this.openSettings(), routerLink: settingsLink },
      { label: 'Logout', icon: 'pi pi-sign-out', command: () => this.logout() },
    ];
  }

  private exportProjectData(): void {
    if (!this.projectId) return;
    const ref = this.dialogService.open(ExportModal, {
      header: 'Configure Export',
      width: '720px',
      modal: true,
      dismissableMask: true,
      closable: true,
      data: { projectId: this.projectId },
    });
    this.exportDialogRef = ref ?? undefined;
  }

  public handleMenuItemClick(event: Event, item: PermissionMenuItem): void {
    if (!item.command) return;

    if (!item.routerLink) {
      event.preventDefault();
    }

    item.command({ originalEvent: event, item });
  }

  toggleDarkMode(): void {
    this.themeService.toggleDarkMode();
    this.buildFooterItems();
  }

  private buildFooterItems(): void {
    this.footerItems = [
      { label: 'Toggle appearance', piIcon: this.themeService.isDark ? 'pi pi-sun' : 'pi pi-moon', command: () => this.toggleDarkMode() },
      { label: 'User', faIcon: faUser, command: (event) => this.openUserMenu(event) },
    ];
  }

  private openSettings(): void {
    // Placeholder: settings route not wired yet
  }

  private openUserMenu(event: { originalEvent?: Event }): void {
    if (event?.originalEvent)
      this.userMenu?.toggle(event.originalEvent);
  }

  private logout(): void {
    this.authService.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }
}
