import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ThemeService {
  private _isDarkMode: boolean = false;

  get isDark(): boolean {
    return this._isDarkMode;
  }

  constructor() {
    this.loadTheme();
  }

  toggleDarkMode(): void {
    this._isDarkMode = !this._isDarkMode;
    localStorage.setItem('theme', this._isDarkMode ? 'dark' : 'light');
    const element = document.querySelector('html');
    element?.classList.toggle('app-dark-mode', this._isDarkMode);
    console.log(`Dark mode is now ${this._isDarkMode ? 'enabled' : 'disabled'}`);
  }

  private loadTheme(): void {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
      this._isDarkMode = savedTheme === 'dark';
      const element = document.querySelector('html');
      element?.classList.toggle('app-dark-mode', this._isDarkMode);
    }
  }
}
