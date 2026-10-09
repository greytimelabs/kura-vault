export enum UserRole {
  OWNER = 'owner',
  VIEWER = 'viewer',
}

export enum VaultPermission {
  ADMIN = 'admin',
  VIEW = 'view',
}

export enum MediaType {
  PHOTO = 'photo',
  VIDEO = 'video',
}

export enum AlbumKind {
  REGULAR = 'regular', // shared by everyone with access to the vault
  LIKED = 'liked', // one per user per vault, private to that user
}

export interface JwtPayload {
  sub: string; // user id
  deviceId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest {
  user: JwtPayload;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
