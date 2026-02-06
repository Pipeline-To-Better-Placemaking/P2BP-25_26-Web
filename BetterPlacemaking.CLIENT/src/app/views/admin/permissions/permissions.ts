import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TableModule } from 'primeng/table';
import { MultiSelectModule } from 'primeng/multiselect';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { UsersService, ApiUser } from '../../../services/users-service';

interface Project {
  id: number;
  name: string;
}

interface UserRow {
  id: string; // Firestore doc id is a string
  name: string;
  assignedProjects: number[];
  savedMessage?: string;
}

@Component({
  selector: 'app-permissions',
  standalone: true,
  imports: [CommonModule, TableModule, MultiSelectModule, FormsModule, ButtonModule, MessageModule],
  templateUrl: './permissions.html',
  styleUrls: ['./permissions.scss'],
})
export class Permissions implements OnInit {
  users: UserRow[] = [];
  projects: Project[] = [];

  constructor(private usersService: UsersService) {}

  ngOnInit(): void {
    this.projects = [
      { id: 1, name: 'Project Alpha' },
      { id: 2, name: 'Project Beta' },
      { id: 3, name: 'Project Gamma' },
      { id: 4, name: 'Project Delta' },
    ];

    this.usersService.getUsers().subscribe({
      next: (apiUsers: ApiUser[]) => {
        this.users = apiUsers.map((u: ApiUser) => ({
          id: u.id,
          name: this.pickDisplayName(u),
          assignedProjects: [],
        }));
      },
      error: (err: any) => {
        console.error('Failed to load users', err);
      },
    });
  }

  private pickDisplayName(u: ApiUser): string {
    const dn = (u.displayName ?? '').trim();
    if (dn) return dn;

    const full = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    if (full) return full;

    return u.email ?? '(unknown user)';
  }

  saveUserPermissions(user: UserRow): void {
    console.log(`Saved permissions for ${user.name}:`, user.assignedProjects);
    user.savedMessage = 'Saved changes!';

    setTimeout(() => {
      user.savedMessage = undefined;
    }, 3000);
  }
}
