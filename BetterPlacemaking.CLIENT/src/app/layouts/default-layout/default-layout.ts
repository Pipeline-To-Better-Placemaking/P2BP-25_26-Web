import { Component } from '@angular/core';
import { RouterModule, RouterOutlet } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { AvatarModule } from 'primeng/avatar';
import { MenuModule } from 'primeng/menu';
import { FontAwesomeModule, FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { faHome, faFolder, faChartLine, faCog, faSignOutAlt, faMoon } from '@fortawesome/free-solid-svg-icons';
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
    { label: 'Dashboard', faIcon: faHome, routerLink: '/dashboard' },
    { label: 'Projects', faIcon: faFolder, routerLink: '/projects' },
    { label: 'Insights', faIcon: faChartLine, routerLink: '/insights' },
    { label: 'Settings', faIcon: faCog, routerLink: '/settings' }
  ];

  footerItems: MenuItem[] = [
    { label: 'Toggle dark mode', faIcon: faMoon, command: () => this.toggleDarkMode() },
    { label: 'Log out', faIcon: faSignOutAlt }
  ];

  toggleDarkMode(): void {
    this.themeService.toggleDarkMode();
  }
}
