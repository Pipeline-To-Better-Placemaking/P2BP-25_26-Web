import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private isDarkMode: boolean = false;

  constructor() {
    this.loadTheme();
  }

  toggleDarkMode(): void {
    this.isDarkMode = !this.isDarkMode;
    localStorage.setItem('theme', this.isDarkMode ? 'dark' : 'light');
    const element = document.querySelector('html');
    element?.classList.toggle('app-dark-mode', this.isDarkMode);
    console.log(`Dark mode is now ${this.isDarkMode ? 'enabled' : 'disabled'}`);
  }

  private loadTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      this.isDarkMode = savedTheme === 'dark';
      const element = document.querySelector('html');
      element?.classList.toggle('app-dark-mode', this.isDarkMode);
    }
  }
}
