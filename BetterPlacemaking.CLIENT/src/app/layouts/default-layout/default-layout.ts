import { Component, OnDestroy } from '@angular/core';
import { NavigationEnd, Router, RouterModule, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { FontAwesomeModule, FaIconLibrary } from '@fortawesome/angular-fontawesome';
import {
  faHome,
  faFolder,
  faChartLine,
  faCog,
  faSignOutAlt,
  faMoon,
  faUser,
} from '@fortawesome/free-solid-svg-icons';
import { MenuItem } from 'primeng/api';
import { ThemeService } from '../../services/theme-service';
import { filter, startWith, Subscription } from 'rxjs';
import { NgIf } from '@angular/common';

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

  constructor(public themeService: ThemeService, private router: Router) {}

  navItems: MenuItem[] = [];

  navItemsIfSelected: MenuItem[] = [];

  navItemsAdmin: MenuItem[] = [];

  footerItems: MenuItem[] = [];

  ngOnInit(): void {
    // initialize footer which is static
    this.footerItems = [
      { label: 'Toggle dark mode', faIcon: faMoon, command: () => this.toggleDarkMode() },
      { label: 'User', faIcon: faUser, routerLink: '/profile' },
    ];

    this.navItems = [{ label: 'Select Project', faIcon: faHome, routerLink: '/projects' }];
    this.navItemsAdmin = [
      {
        label: 'Admin',
        items: [
          { label: 'Permissions', faIcon: faChartLine, routerLink: '/admin/permissions' },
          { label: 'Manage Projects', faIcon: faFolder, routerLink: '/admin/projects' },
        ],
      },
    ];

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
      const base = `/projects/${projectId}`;
      this.navItemsIfSelected = [
        {
          label: 'Project',
          items: [
            { label: 'Dashboard', faIcon: faHome, routerLink: `${base}/dashboard` },
            { label: '3D Model', faIcon: faHome, routerLink: `${base}/3d` },
            { label: 'Vision', faIcon: faHome, routerLink: `${base}/vision` },
            { label: 'Edit Room', faIcon: faHome, routerLink: `${base}/edit` },
          ],
        },
      ];
    } else {
      // No project selected - show fallback links or clear the section
      this.navItemsIfSelected = [
      ];
    }
  }

  toggleDarkMode(): void {
    this.themeService.toggleDarkMode();
  }
}
