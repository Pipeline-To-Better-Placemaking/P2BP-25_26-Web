import { Component } from '@angular/core';
import { RouterModule, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { FontAwesomeModule, FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faHome, faFolder, faChartLine, faCog, faSignOutAlt, faMoon, faUser } from '@fortawesome/free-solid-svg-icons';
import { MenuItem } from 'primeng/api';
import { ThemeService } from '../../services/theme-service';

@Component({
  selector: 'app-default-layout',
  standalone: true,
  imports: [RouterOutlet, ButtonModule, AvatarModule, MenuModule, RouterModule, FontAwesomeModule],
  templateUrl: './default-layout.html',
  styleUrl: './default-layout.scss',
})
export class DefaultLayout {

  constructor(public themeService: ThemeService) {}

  navItems: MenuItem[] = [
    { label: 'Select Project', faIcon: faHome, routerLink: '/selectProject' },
  ];

  navItemsIfSelected: MenuItem[] = [
    { label: '3D Model', faIcon: faHome, routerLink: '/selectProject' },
    { label: 'Vision', faIcon: faHome, routerLink: '/selectProject' },
    { label: 'Edit Room', faIcon: faHome, routerLink: '/selectProject' },
  ];

  navItemsAdmin: MenuItem[] = [
    { label: 'Permissions', faIcon: faChartLine, routerLink: '/admin/permissions' },
    { label: 'Manage Projects', faIcon: faFolder, routerLink: '/admin/projects' },
  ];

  footerItems: MenuItem[] = [
    { label: 'Toggle dark mode', faIcon: faMoon, command: () => this.toggleDarkMode() },
    { label: 'User', faIcon: faUser, routerLink: '/profile' },
  ];

  toggleDarkMode(): void {
    this.themeService.toggleDarkMode();
  }
}
