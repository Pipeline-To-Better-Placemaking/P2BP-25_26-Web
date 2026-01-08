export interface AuthUser {
  Id?: string | null;
  FirstName?: string | null;
  LastName?: string | null;
  Email?: string | null;
}

export interface AuthResponse {
  Success: boolean;
  Message?: string | null;
  User?: AuthUser | null;
  Token?: string | null;
  ExpiresAtUtc?: string | null;
}

export interface StoredAuth {
  Token: string;
  ExpiresAtUtc: string;
  User: AuthUser;
}
