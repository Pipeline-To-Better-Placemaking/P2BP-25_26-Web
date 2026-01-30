import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { MultiSelectModule } from 'primeng/multiselect';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

interface Project {
  id: number;
  name: string;
}

interface User {
  id: number;
  name: string;
  assignedProjects: number[];
  savedMessage?: string; // <-- temporary message per user
}

@Component({
  selector: 'app-permissions',
  standalone: true,
  imports: [CommonModule, TableModule, MultiSelectModule, FormsModule, ButtonModule, MessageModule],
  templateUrl: './permissions.html',
  styleUrls: ['./permissions.scss'],
})
export class Permissions implements OnInit {
  users: User[] = [];
  projects: Project[] = [];

  constructor() {}

  ngOnInit(): void {
    // Dummy projects
    this.projects = [
      { id: 1, name: 'Project Alpha' },
      { id: 2, name: 'Project Beta' },
      { id: 3, name: 'Project Gamma' },
      { id: 4, name: 'Project Delta' },
    ];

    // Dummy users
    this.users = [
      { id: 1, name: 'Alice', assignedProjects: [1, 3] },
      { id: 2, name: 'Bob', assignedProjects: [2] },
      { id: 3, name: 'Charlie', assignedProjects: [] },
      { id: 4, name: 'Diana', assignedProjects: [1, 2, 3] },
      { id: 5, name: 'Eve', assignedProjects: [] },
      { id: 6, name: 'Frank', assignedProjects: [4] },
      { id: 7, name: 'Grace', assignedProjects: [] },
    ];
  }

  saveUserPermissions(user: User) {
    console.log(`Saved permissions for ${user.name}:`, user.assignedProjects);
    user.savedMessage = 'Saved changes!';

    // Hide the message after 3 seconds
    setTimeout(() => {
      user.savedMessage = undefined;
    }, 3000);

    // Here, you would also call your backend service to persist permissions
  }
}
