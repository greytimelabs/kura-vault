import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VaultMember } from '../../modules/vault/entities/vault-member.entity';
import { AlbumMember } from '../../modules/album/entities/album-member.entity';
import { Album } from '../../modules/album/entities/album.entity';
import { Media } from '../../modules/media/entities/media.entity';
import { AlbumKind, SharePermission, VaultMemberRole } from '../types';

export interface Access {
  canView: boolean;
  canWrite: boolean;
  /** Created the vault: the only one who may share it or its albums. */
  isCreator: boolean;
  /** Access comes from the vault itself rather than from one shared album. */
  viaVault: boolean;
}

const NONE: Access = { canView: false, canWrite: false, isCreator: false, viaVault: false };

/**
 * The one place that decides who may do what. Access comes only from
 * `vault_members` and `album_members`: the server owner gets nothing extra, and
 * deleting a row takes the access away on the next request.
 */
@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(VaultMember) private readonly vaultMemberRepo: Repository<VaultMember>,
    @InjectRepository(AlbumMember) private readonly albumMemberRepo: Repository<AlbumMember>,
  ) {}

  async forVault(userId: string, vaultId: string): Promise<Access> {
    const member = await this.vaultMemberRepo.findOne({ where: { userId, vaultId } });
    if (!member) {
      return NONE;
    }
    const isCreator = member.role === VaultMemberRole.CREATOR;
    return {
      canView: true,
      canWrite: isCreator || member.permission === SharePermission.WRITE,
      isCreator,
      viaVault: true,
    };
  }

  /** A private album (Liked) belongs to one user. A regular album is open to vault members and to whoever it is shared with. */
  async forAlbum(userId: string, album: Pick<Album, 'id' | 'vaultId' | 'kind' | 'ownerUserId'>): Promise<Access> {
    if (album.ownerUserId && album.ownerUserId !== userId) {
      return NONE;
    }
    const viaVault = await this.forVault(userId, album.vaultId);
    if (viaVault.canView) {
      return viaVault;
    }
    if (album.kind !== AlbumKind.REGULAR) {
      return NONE;
    }
    const member = await this.albumMemberRepo.findOne({ where: { userId, albumId: album.id } });
    if (!member) {
      return NONE;
    }
    return {
      canView: true,
      canWrite: member.permission === SharePermission.WRITE,
      isCreator: false,
      viaVault: false,
    };
  }

  /**
   * One item: through its vault, or through any album shared with the caller that
   * contains it. Album access never allows changing an item that already exists.
   */
  async forMedia(userId: string, media: Pick<Media, 'id' | 'vaultId'>): Promise<Access> {
    const viaVault = await this.forVault(userId, media.vaultId);
    if (viaVault.canView) {
      return viaVault;
    }
    const shared = await this.albumMemberRepo
      .createQueryBuilder('member')
      .innerJoin('album_media', 'am', 'am.album_id = member.album_id')
      .where('member.user_id = :userId', { userId })
      .andWhere('am.media_id = :mediaId', { mediaId: media.id })
      .getCount();
    return shared > 0 ? { canView: true, canWrite: false, isCreator: false, viaVault: false } : NONE;
  }
}
