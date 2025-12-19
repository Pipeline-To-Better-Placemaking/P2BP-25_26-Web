import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class SampleService {
  constructor(private http: HttpClient) {}

  samplePing() {
    return this.http.get(`${environment.apiBaseUrl}/api/Sample/ping`, { responseType: 'text' });
  }
}
