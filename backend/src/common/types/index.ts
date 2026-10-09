export enum UserRole {
  OWNER = 'owner', // the one account that manages users on this server
  MEMBER = 'member',
}

export enum AccessLevel {
  FULL = 'full', // may create vaults of their own
  LIMITED = 'limited', // only what is shared with them
}

export enum UserStatus {
  ACTIVE = 'active',
  RESTRICTED = 'restricted',
}

export enum VaultMemberRole {
  CREATOR = 'creator',
  MEMBER = 'member',
}

export enum SharePermission {
  VIEW = 'view',
  WRITE = 'write',
}

export enum MediaType {
  PHOTO = 'photo',
  VIDEO = 'video',
}

export enum AlbumKind {
  REGULAR = 'regular', // seen by everyone with access to the vault, and shareable on its own
  LIKED = 'liked', // one per user per vault, private to that user
}

export interface JwtPayload {
  sub: string; // user id
  username: string;
  role: UserRole;
  accessLevel: AccessLevel;
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

/** What one user may know about another: enough to verify their keys and share with them. */
export interface PublicUserKeys {
  userId: string;
  username: string;
  publicEncKey: string;
  publicSignKey: string;
  keyCert: string | null;
}
