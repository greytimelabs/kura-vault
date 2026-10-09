import { AccessService } from './access.service';
import { AlbumKind, SharePermission, VaultMemberRole } from '../types';

type VaultRow = { role: VaultMemberRole; permission: SharePermission } | null;
type AlbumRow = { permission: SharePermission } | null;

/** One user, one vault, one album containing one item: only the membership rows vary. */
function makeService(vaultRow: VaultRow, albumRow: AlbumRow) {
  const qb: any = {
    innerJoin: jest.fn(() => qb),
    where: jest.fn(() => qb),
    andWhere: jest.fn(() => qb),
    getCount: jest.fn(async () => (albumRow ? 1 : 0)),
  };
  const vaultMemberRepo = { findOne: jest.fn(async () => vaultRow) };
  const albumMemberRepo = { findOne: jest.fn(async () => albumRow), createQueryBuilder: jest.fn(() => qb) };
  return new AccessService(vaultMemberRepo as any, albumMemberRepo as any);
}

const album = { id: 'album-1', vaultId: 'vault-1', kind: AlbumKind.REGULAR, ownerUserId: null };
const media = { id: 'media-1', vaultId: 'vault-1' };
const creator = { role: VaultMemberRole.CREATOR, permission: SharePermission.WRITE };
const vaultWrite = { role: VaultMemberRole.MEMBER, permission: SharePermission.WRITE };
const vaultView = { role: VaultMemberRole.MEMBER, permission: SharePermission.VIEW };
const albumWrite = { permission: SharePermission.WRITE };
const albumView = { permission: SharePermission.VIEW };

describe('AccessService', () => {
  // [who, vault row, album row, expected on the vault, on the album, on an item in the album]
  const matrix: Array<[string, VaultRow, AlbumRow, string, string, string]> = [
    ['vault creator', creator, null, 'view write creator', 'view write creator', 'view write creator'],
    ['vault write', vaultWrite, null, 'view write', 'view write', 'view write'],
    ['vault view', vaultView, null, 'view', 'view', 'view'],
    ['album write only', null, albumWrite, 'none', 'view write', 'view'],
    ['album view only', null, albumView, 'none', 'view', 'view'],
    ['vault view and album write', vaultView, albumWrite, 'view', 'view', 'view'],
    ['nothing shared', null, null, 'none', 'none', 'none'],
  ];

  const describeAccess = (a: { canView: boolean; canWrite: boolean; isCreator: boolean }) =>
    [a.canView && 'view', a.canWrite && 'write', a.isCreator && 'creator'].filter(Boolean).join(' ') || 'none';

  it.each(matrix)('%s', async (_who, vaultRow, albumRow, onVault, onAlbum, onMedia) => {
    const service = makeService(vaultRow, albumRow);
    expect(describeAccess(await service.forVault('user-1', 'vault-1'))).toBe(onVault);
    expect(describeAccess(await service.forAlbum('user-1', album))).toBe(onAlbum);
    expect(describeAccess(await service.forMedia('user-1', media))).toBe(onMedia);
  });

  it('says whether access comes from the vault or from one album', async () => {
    expect((await makeService(vaultView, null).forAlbum('user-1', album)).viaVault).toBe(true);
    expect((await makeService(null, albumWrite).forAlbum('user-1', album)).viaVault).toBe(false);
  });

  it('never opens another user\'s private album, whatever the vault access', async () => {
    const liked = { ...album, kind: AlbumKind.LIKED, ownerUserId: 'someone-else' };
    expect((await makeService(creator, null).forAlbum('user-1', liked)).canView).toBe(false);
  });

  it('does not treat a Liked album as shareable', async () => {
    const liked = { ...album, kind: AlbumKind.LIKED, ownerUserId: 'user-1' };
    // An album row cannot exist for a Liked album; even if one did, it grants nothing
    expect((await makeService(null, albumWrite).forAlbum('user-1', liked)).canView).toBe(false);
  });
});
