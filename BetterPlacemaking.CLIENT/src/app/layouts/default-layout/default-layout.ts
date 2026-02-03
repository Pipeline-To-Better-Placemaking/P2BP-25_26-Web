import { Component, OnDestroy, ViewChild } from '@angular/core';
import { NavigationEnd, Router, RouterModule, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { Menu, MenuModule } from 'primeng/menu';
import { FontAwesomeModule, FaIconLibrary } from '@fortawesome/angular-fontawesome';
import {
  faHome,
  faFolder,
  faChartLine,
  faCog,
  faSignOutAlt,
  faMoon,
  faUser,
  faCube,
  faEye,
  faPenToSquare,
  faUserShield,
  faFolderOpen,
  faMicrochip,
} from '@fortawesome/free-solid-svg-icons';
import { MenuItem } from 'primeng/api';
import { ThemeService } from '../../services/theme-service';
import { filter, startWith, Subscription } from 'rxjs';
import { NgIf } from '@angular/common';
import { AuthService } from '../../services/auth-service';

@Component({
  selector: 'app-default-layout',
  standalone: true,
  imports: [RouterOutlet, ButtonModule, AvatarModule, MenuModule, RouterModule, FontAwesomeModule, NgIf],
  templateUrl: './default-layout.html',
  styleUrl: './default-layout.scss',
})

export class DefaultLayout implements OnDestroy {
  private projectId?: number;
  private routerSub?: Subscription;

  public readonly faMoon = faMoon;
  public readonly faUser = faUser;

  constructor(
    public themeService: ThemeService,
    private router: Router,
    private authService: AuthService
  ) {}

  navItems: MenuItem[] = [];

  navItemsIfSelected: MenuItem[] = [];

  navItemsAdmin: MenuItem[] = [];

  footerItems: MenuItem[] = [];
  userMenuItems: MenuItem[] = [];

  @ViewChild('userMenu') private userMenu?: Menu;

  ngOnInit(): void {
    this.footerItems = [
      { label: 'Toggle dark mode', faIcon: faMoon, command: () => this.toggleDarkMode() },
      { label: 'User', faIcon: faUser, command: (event) => this.openUserMenu(event) },
    ];

    this.userMenuItems = [
      { label: 'Settings', icon: 'pi pi-cog', command: () => this.openSettings(), routerLink: '/user-settings' },
      { label: 'Logout', icon: 'pi pi-sign-out', command: () => this.logout() },
    ];

    this.navItems = [{ label: 'Select Project', faIcon: faFolder, routerLink: '/projects' }];

    // Listen for navigation end events and rebuild menus when project id changes
    this.routerSub = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd), startWith(null))
      .subscribe(() => {
        const newId = this.parseProjectIdFromUrl(this.router.url || '');
        this.projectId = newId;
        this.buildNavMenus(this.projectId);
      });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
  }

  private parseProjectIdFromUrl(url: string): number | undefined {
    const raw = url.split('?')[0];
    const segments = raw.split('/').filter(Boolean);
    for (let i = segments.length - 1; i >= 0; i--) {
      const val = Number(segments[i]);
      if (!Number.isNaN(val) && Number.isFinite(val) && Number.isInteger(val)) {
        return val;
      }
    }
    return undefined;
  }

  private buildNavMenus(projectId?: number): void {

    if (projectId != null) {
      const base = `${projectId}`;
      this.navItemsIfSelected = [
        {
          label: 'Project',
          items: [
            { label: 'Dashboard', faIcon: faChartLine, routerLink: `${base}/dashboard` },
            { label: '3D Model', faIcon: faCube, routerLink: `${base}/model` },
            { label: 'Vision', faIcon: faEye, routerLink: `${base}/vision` },
            { label: 'Edit Room', faIcon: faPenToSquare, routerLink: `${base}/edit` },
          ],
        },
      ];
      this.navItemsAdmin = [
        {
          label: 'Admin',
          items: [
            { label: 'Permissions', faIcon: faUserShield, routerLink: `${base}/admin/permissions` },
            { label: 'Manage Projects', faIcon: faFolderOpen, routerLink: `${base}/admin/projects` },
            { label: 'Devices', faIcon: faMicrochip, routerLink: `${base}/admin/devices` },
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
            { label: 'Permissions', faIcon: faUserShield, routerLink: '/admin/permissions' },
            { label: 'Manage Projects', faIcon: faFolderOpen, routerLink: '/admin/projects' },
            { label: 'Devices', faIcon: faMicrochip, routerLink: '/admin/devices' },
          ],
        },
      ];
    }
  }

  toggleDarkMode(): void {
    this.themeService.toggleDarkMode();
  }

  private openSettings(): void {
    // Placeholder: settings route not wired yet
  }

  private openUserMenu(event: { originalEvent?: Event }): void {
    if (event?.originalEvent) {
      this.userMenu?.toggle(event.originalEvent);
    }
  }

  private logout(): void {
    this.authService.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }
}
