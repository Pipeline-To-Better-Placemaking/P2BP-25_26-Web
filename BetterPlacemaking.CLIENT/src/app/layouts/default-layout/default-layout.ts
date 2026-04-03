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
import { ExportService } from '../../services/export-service';

@Component({
  selector: 'app-default-layout',
  standalone: true,
  imports: [RouterOutlet, ButtonModule, AvatarModule, MenuModule, RouterModule, FontAwesomeModule, NgIf],
  templateUrl: './default-layout.html',
  styleUrl: './default-layout.scss',
})

export class DefaultLayout implements OnInit, OnDestroy {
  private projectId?: string;
  private routerSub?: Subscription;

  public readonly faMoon = faMoon;
  public readonly faUser = faUser;

  public currentProjectName: string | null = null;

  constructor(
    public themeService: ThemeService,
    private router: Router,
    private route: ActivatedRoute,
    private authService: AuthService,
    private projectService: ProjectService,
    private exportService: ExportService
  ) {}

  navItems: MenuItem[] = [];

  navItemsIfSelected: MenuItem[] = [];

  navItemsAdmin: MenuItem[] = [];

  footerItems: MenuItem[] = [];
  userMenuItems: MenuItem[] = [];

  @ViewChild('userMenu') private userMenu?: Menu;

  ngOnInit(): void {
    this.buildFooterItems();

    this.userMenuItems = [
      { label: 'Settings', icon: 'pi pi-cog', command: () => this.openSettings(), routerLink: '/user-settings' },
      { label: 'Logout', icon: 'pi pi-sign-out', command: () => this.logout() },
    ];

    this.navItems = [{ label: 'Select Project', faIcon: faFolder, routerLink: '/projects' }];

    // Listen for navigation end events and rebuild menus when project id changes
    this.routerSub = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd), startWith(null))
      .subscribe(() => {
        const newId = this.getProjectIdFromRoute(this.route);
        const changed = newId !== this.projectId;
        this.projectId = newId;
        this.buildNavMenus(this.projectId);

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
            { label: 'Dashboard', faIcon: faChartLine, routerLink: `/${base}/dashboard` },
            { label: '3D Model', faIcon: faCube, routerLink: `/${base}/model` },
            { label: 'Vision', faIcon: faEye, routerLink: `/${base}/vision` },
            { label: 'Edit Room', faIcon: faPenToSquare, routerLink: `/${base}/edit` },
            { label: 'Permissions', faIcon: faUserShield, routerLink: `/${base}/admin/permissions` },
            { label: 'Export Data', faIcon: faDownload, command: () => this.exportProjectData() },
          ],
        },
      ];
      this.navItemsAdmin = [
        {
          label: 'Admin',
          items: [
            { label: 'Users', faIcon: faUserShield, routerLink: `/${base}/admin/users` },
            { label: 'Manage Projects', faIcon: faFolderOpen, routerLink: `/${base}/admin/projects` },
            { label: 'Devices', faIcon: faMicrochip, routerLink: `/${base}/admin/devices` },
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
            { label: 'Users', faIcon: faUserShield, routerLink: '/admin/users' },
            { label: 'Manage Projects', faIcon: faFolderOpen, routerLink: '/admin/projects' },
            { label: 'Devices', faIcon: faMicrochip, routerLink: '/admin/devices' },
          ],
        },
      ];
    }
  }

  private exportProjectData(): void {
    if (this.projectId) {
      this.exportService.exportProjectPdf(this.projectId);
    }
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
