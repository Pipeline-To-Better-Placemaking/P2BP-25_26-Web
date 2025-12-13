import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  public DoStuff(): void {
    console.log('Doing stuff');
  }
}
