export type UserRole = 'owner' | 'viewer';

export interface SessionUser {
  id: string;
  deviceId: string;
  role: UserRole;
}

export interface LoginResponse {
  accessToken: string;
  expiresIn: string;
  user: { id: string; name: string; role: UserRole };
}

export interface RefreshResponse {
  accessToken: string;
  expiresIn: string;
}

export type MediaType = 'photo' | 'video';

export interface MediaItem {
  id: string;
  mediaType: MediaType;
  capturedAt: string | null;
  yearMonth: string | null;
  width: number | null;
  height: number | null;
  aspectRatio: number | null;
  durationSeconds: number | null;
  thumbIv: string;
  encryptedDek: string;
  dekNonce: string;
  encryptedMeta: string | null;
  metaNonce: string | null;
  thumbUrl: string;
  isLiked: boolean;
}

export interface MediaPage {
  data: MediaItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface MediaUrls {
  previewUrl: string;
  originalUrl: string;
  previewIv: string;
  originalIv: string;
}

export type AlbumKind = 'regular' | 'liked';

export interface Album {
  id: string;
  keyGroupId: string;
  kind: AlbumKind;
  nameEncrypted: string | null;
  nameNonce: string | null;
  coverMediaId: string | null;
  sortOrder: number;
  mediaCount: number;
}

export interface UploadInitResponse {
  mediaId: string;
  uploadUrls: { thumb: string; preview: string; original: string };
}

export interface InviteResponse {
  code: string;
  expiresAt: string;
}

/** Decrypted contents of a media item's encryptedMeta. */
export interface MediaMeta {
  filename?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
}
