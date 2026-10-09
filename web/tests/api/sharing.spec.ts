import { expect, test } from '@playwright/test';
import pg from 'pg';
import { aad } from '../../src/lib/crypto/aad';
import { randomBytes } from '../../src/lib/crypto/aesgcm';
import { b64decode, b64encode } from '../../src/lib/crypto/base64';
import { generateIdentity, importSignPrivate, seal, signGrant } from '../../src/lib/crypto/identity';
import { ApiError, ApiUser, api } from '../e2e/apiUser';
import { DB, OWNER, SETUP_KEY } from '../e2e/env';

// One story told in order against one database: every test builds on the last.
test.describe.configure({ mode: 'serial' });

const PASSWORD = 'Member-Passw0rd!-e2e';
const VAULT_PASSPHRASE = 'family vault passphrase';

let db: pg.Client;
let owner: ApiUser;
let mira: ApiUser; // limited access
let dev: ApiUser; // full access
let familyVault: string;
let devVault: string;
let tripAlbum: string;

const status = async (work: Promise<unknown>): Promise<number> => {
  try {
    await work;
    return 200;
  } catch (err) {
    if (err instanceof ApiError) return err.status;
    throw err;
  }
};

test.beforeAll(async () => {
  db = new pg.Client(DB);
  await db.connect();
});

test.afterAll(async () => {
  await db.end();
});

test('a new server can only be set up with the setup key, and only once', async () => {
  expect((await api<{ setupRequired: boolean }>('GET', '/health')).setupRequired).toBe(true);
  expect(await status(api('POST', '/auth/register', { body: { username: 'someone', password: PASSWORD } }))).toBe(404);
  expect(await status(ApiUser.setup('x'.repeat(40), OWNER))).toBe(403);

  owner = await ApiUser.setup(SETUP_KEY, OWNER);
  expect(owner.keys.keyCert).not.toBeNull();
  expect(owner.keyring.isTrustRoot()).toBe(true);

  expect((await api<{ setupRequired: boolean }>('GET', '/health')).setupRequired).toBe(false);
  expect(await status(ApiUser.setup(SETUP_KEY, { ...OWNER, username: 'second-owner' }))).toBe(403);
});

test('the database holds no usable secret for the owner', async () => {
  const { rows } = await db.query('SELECT * FROM users');
  expect(rows).toHaveLength(1);
  const dump = JSON.stringify(rows[0]);
  expect(dump).not.toContain(OWNER.password);
  expect(dump).not.toContain(OWNER.passphrase);
  expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
});

test('the master passphrase is checked on the device', async () => {
  expect(await owner.unlock('not the passphrase')).toBe(false);
  expect(await owner.unlock()).toBe(true);
});

test('only the owner invites; an invite link creates exactly the account the owner defined', async () => {
  const miraInvite = await owner.invite('mira.k', 'limited');
  const devInvite = await owner.invite('dev', 'full');
  expect(await status(owner.invite('mira.k', 'full'))).toBe(409);

  // The server never sees the link's secret, only a hash of a token derived from it
  const { rows } = await db.query('SELECT * FROM user_invites');
  expect(JSON.stringify(rows)).not.toContain(miraInvite.invite.secret);

  expect(await status(api('GET', `/invites/${miraInvite.invite.inviteId}`, { headers: { 'X-Invite-Token': b64encode(randomBytes(32)) } }))).toBe(404);

  mira = await ApiUser.join(miraInvite.link, PASSWORD, 'mira master passphrase');
  dev = await ApiUser.join(devInvite.link, PASSWORD, 'dev master passphrase');
  expect(mira.id).toBe(miraInvite.userId);
  expect(mira.keyring.isTrustRoot()).toBe(false);
  expect(mira.keyring.trustedOwnerKey()).toBe(owner.keys.publicSignKey);

  // Single use
  expect(await status(ApiUser.join(miraInvite.link, PASSWORD, 'someone else entirely'))).toBe(404);

  for (const user of [mira, dev]) {
    expect(await status(user.call('GET', '/users'))).toBe(403);
    expect(await status(user.invite('friend', 'limited'))).toBe(403);
  }
});

test('nothing can be shared with a user until the owner has verified their keys', async () => {
  familyVault = await owner.createVault(VAULT_PASSPHRASE, 'Family');
  expect((await owner.directory()).map((u) => u.username)).toEqual([]);

  // The client refuses an uncertified user, and so does the server
  await expect(owner.shareVault(familyVault, mira.keys, 'view')).rejects.toThrow(/could not be verified/);
  const forged = { ...mira.keys, keyCert: owner.keys.keyCert };
  await expect(owner.shareVault(familyVault, forged, 'view')).rejects.toThrow(/could not be verified/);

  expect(await owner.certifyPending()).toEqual([]);
  expect((await owner.directory()).map((u) => u.username)).toEqual(['dev', 'mira.k']);
  // The invitation rows, with the sealed link secrets, are gone
  expect((await db.query('SELECT 1 FROM user_invites')).rowCount).toBe(0);
});

test('a server that swaps a new user\'s public key is caught before anything is shared', async () => {
  const invite = await owner.invite('swapped', 'limited');
  const victim = await ApiUser.join(invite.link, PASSWORD, 'victim master passphrase');
  const attacker = await generateIdentity();
  await db.query('UPDATE users SET public_enc_key = $1 WHERE id = $2', [b64encode(attacker.encPk), victim.id]);

  expect(await owner.certifyPending()).toEqual(['swapped']);
  expect((await owner.directory()).map((u) => u.username)).not.toContain('swapped');
  // And the victim's own client notices its keys were replaced
  await expect(victim.unlock()).rejects.toThrow(/not yours/);
});

test('a server that swaps a certified user\'s key cannot receive a share', async () => {
  const attacker = await generateIdentity();
  const [real] = (await owner.directory()).filter((u) => u.username === 'mira.k');
  await db.query('UPDATE users SET public_enc_key = $1 WHERE id = $2', [b64encode(attacker.encPk), mira.id]);
  const [tampered] = (await owner.directory()).filter((u) => u.username === 'mira.k');
  expect(tampered!.publicEncKey).toBe(b64encode(attacker.encPk));

  await expect(owner.shareVault(familyVault, tampered!, 'view')).rejects.toThrow(/could not be verified/);
  expect((await db.query('SELECT 1 FROM vault_members WHERE user_id = $1', [mira.id])).rowCount).toBe(0);

  await db.query('UPDATE users SET public_enc_key = $1 WHERE id = $2', [real!.publicEncKey, mira.id]);
});

test('limited users cannot create vaults; full users can, and the owner cannot reach them', async () => {
  expect(await status(mira.createVault('mira vault passphrase', 'Mine'))).toBe(403);

  devVault = await dev.createVault('dev vault passphrase', 'Dev private');
  await dev.upload(devVault, 'dev-secret.jpg');

  expect((await owner.vaults()).map((v) => v.id)).toEqual([familyVault]);
  expect(await status(owner.listMedia({ vaultId: devVault }))).toBe(403);
  expect(await status(owner.call('GET', `/albums?vaultId=${devVault}`))).toBe(403);
  expect(await status(owner.call('GET', `/vaults/${devVault}/members`))).toBe(404);
  expect(await status(owner.upload(devVault, 'intruder.jpg'))).toBe(403);
});

test('an own vault opens only with its passphrase, after the account is unlocked', async () => {
  await owner.upload(familyVault, 'beach.jpg');
  await owner.upload(familyVault, 'forest.jpg');

  // A fresh session: signed in and unlocked, but no vault passphrase entered yet
  const session = await ApiUser.signIn(OWNER);
  const rows = await session.listMedia({ vaultId: familyVault });
  expect(rows).toHaveLength(2);
  expect(await session.filenames(rows)).toEqual([null, null]);

  expect(await session.openOwnVaults('wrong vault passphrase')).toEqual([]);
  expect(await session.openOwnVaults(VAULT_PASSPHRASE)).toEqual(['Family']);
  expect((await session.filenames(rows)).sort()).toEqual(['beach.jpg', 'forest.jpg']);
});

test('a vault shared view-only can be read and not written', async () => {
  const [recipient] = (await owner.directory()).filter((u) => u.username === 'mira.k');
  await owner.shareVault(familyVault, recipient!, 'view');
  expect(await status(owner.shareVault(familyVault, recipient!, 'view'))).toBe(409);

  // No vault passphrase involved: the key arrives sealed to her public key
  expect(await mira.openSharedVaults()).toEqual(['Family']);
  const rows = await mira.listMedia({ vaultId: familyVault });
  expect((await mira.filenames(rows)).sort()).toEqual(['beach.jpg', 'forest.jpg']);
  expect(await status(mira.call('GET', `/media/${rows[0]!.id}/urls`))).toBe(200);

  expect(await status(mira.upload(familyVault, 'not-allowed.jpg'))).toBe(403);
  expect(await status(mira.createAlbum(familyVault, 'Not allowed'))).toBe(403);
  // A recipient cannot share onward or see who else has access
  expect(await status(mira.call('GET', `/vaults/${familyVault}/members`))).toBe(403);
  const [devKeys] = (await owner.directory()).filter((u) => u.username === 'dev');
  expect(await status(mira.shareVault(familyVault, devKeys!, 'view'))).toBe(403);
});

test('with write access a limited user can upload and create albums in the shared vault', async () => {
  await owner.call('PATCH', `/vaults/${familyVault}/members/${mira.id}`, { permission: 'write' });

  await mira.upload(familyVault, 'from-mira.jpg');
  const album = await mira.createAlbum(familyVault, 'Mira picks');

  const names = await owner.openAlbums(familyVault);
  expect(names.get(album)).toBe('Mira picks');
  const rows = await owner.listMedia({ vaultId: familyVault });
  expect((await owner.filenames(rows)).sort()).toEqual(['beach.jpg', 'forest.jpg', 'from-mira.jpg']);
});

test('one album can be shared without the rest of the vault', async () => {
  tripAlbum = await owner.createAlbum(familyVault, 'Trip');
  const inAlbum = await owner.upload(familyVault, 'trip-1.jpg', tripAlbum);
  const [recipient] = (await owner.directory()).filter((u) => u.username === 'dev');
  await owner.shareAlbum(tripAlbum, recipient!, 'view');

  expect(await dev.openSharedAlbums()).toEqual(['Trip']);
  const rows = await dev.listMedia({ albumId: tripAlbum });
  expect(rows.map((r) => r.id)).toEqual([inAlbum.id]);
  expect(rows[0]!.key).toMatchObject({ scope: 'album', albumId: tripAlbum });
  expect(await dev.filenames(rows)).toEqual(['trip-1.jpg']);
  expect(await status(dev.call('GET', `/media/${inAlbum.id}/urls`))).toBe(200);

  // Nothing else in the vault is reachable, by listing or by id
  const others = (await owner.listMedia({ vaultId: familyVault })).filter((r) => r.id !== inAlbum.id);
  expect(others.length).toBeGreaterThan(0);
  expect(await status(dev.listMedia({ vaultId: familyVault }))).toBe(403);
  expect(await status(dev.call('GET', `/albums?vaultId=${familyVault}`))).toBe(403);
  expect(await status(dev.call('GET', `/media/${others[0]!.id}/urls`))).toBe(404);
  expect((await dev.vaults()).map((v) => v.id)).toEqual([devVault]);

  // View only
  expect(await status(dev.upload(familyVault, 'not-allowed.jpg', tripAlbum))).toBe(403);
});

test('an album-only writer uploads into the album, and vault members can still read it', async () => {
  await owner.call('PATCH', `/albums/${tripAlbum}/members/${dev.id}`, { permission: 'write' });

  const uploaded = await dev.upload(familyVault, 'trip-from-dev.jpg', tripAlbum);
  // Only into that album, and no reorganising
  expect(await status(dev.upload(familyVault, 'outside.jpg'))).toBe(403);
  expect(await status(dev.call('DELETE', `/albums/${tripAlbum}/media/${uploaded.id}`))).toBe(403);
  expect(await status(dev.call('PUT', `/albums/${tripAlbum}`, { sortOrder: 3 }))).toBe(403);

  // The owner reaches it through vault key -> album key -> item key
  await owner.openAlbums(familyVault);
  const row = (await owner.listMedia({ vaultId: familyVault })).find((r) => r.id === uploaded.id)!;
  expect(row.key).toMatchObject({ scope: 'album', albumId: tripAlbum });
  expect(await owner.filenames([row])).toEqual(['trip-from-dev.jpg']);

  // It cannot leave the album while the album is the only way to its key
  expect(await status(owner.call('DELETE', `/albums/${tripAlbum}/media/${uploaded.id}`))).toBe(409);
  const vaultWrap = await owner.keyring.rewrapMediaKey({
    mediaId: uploaded.id,
    key: owner.keyRef(row)!,
    target: { vaultId: familyVault },
  });
  await owner.call('PUT', `/media/${uploaded.id}/vault-key`, { keyWrapped: vaultWrap.wrapped, keyNonce: vaultWrap.nonce });
  expect(await status(owner.call('DELETE', `/albums/${tripAlbum}/media/${uploaded.id}`))).toBe(200);

  const after = (await owner.listMedia({ vaultId: familyVault })).find((r) => r.id === uploaded.id)!;
  expect(after.key).toMatchObject({ scope: 'vault' });
  expect(await owner.filenames([after])).toEqual(['trip-from-dev.jpg']);
  expect((await dev.listMedia({ albumId: tripAlbum })).map((r) => r.id)).not.toContain(uploaded.id);
});

test('a share the server made up is not used', async () => {
  // The server seals a key it knows to mira and claims dev shared dev's vault with her
  const serverKey = randomBytes(32);
  const sealed = await seal(b64decode(mira.keys.publicEncKey), serverKey, aad.vaultKey(devVault, mira.id));
  const forger = await generateIdentity();
  const forgedSig = await signGrant(await importSignPrivate(forger.signSk), 'vault', devVault, mira.id, dev.id, sealed);
  await db.query(
    `INSERT INTO vault_members (vault_id, user_id, role, permission, wrapped_key, granted_by, grant_sig)
     VALUES ($1, $2, 'member', 'write', $3, $4, $5)`,
    [devVault, mira.id, b64encode(sealed), dev.id, forgedSig],
  );

  const shared = (await mira.vaults()).filter((v) => v.role === 'member');
  const labels = await mira.keyring.openSharedVaults({ vaults: shared });
  expect(labels[shared.findIndex((v) => v.id === devVault)]).toBeNull();
  // Without the key in her keyring she cannot be tricked into encrypting under it
  await expect(mira.upload(devVault, 'would-leak.jpg')).rejects.toThrow(/locked/i);

  await db.query('DELETE FROM vault_members WHERE vault_id = $1 AND user_id = $2', [devVault, mira.id]);
});

test('a wrapped key moved to another item does not decrypt', async () => {
  const rows = await owner.listMedia({ vaultId: familyVault });
  const [a, b] = rows.filter((r) => r.key?.scope === 'vault');
  await db.query(
    `UPDATE media SET key_wrapped_vault = $1, key_nonce_vault = $2 WHERE id = $3`,
    [b!.key!.wrapped, b!.key!.nonce, a!.id],
  );
  const tampered = (await owner.listMedia({ vaultId: familyVault })).find((r) => r.id === a!.id)!;
  expect(await owner.filenames([tampered])).toEqual([null]);

  await db.query(
    `UPDATE media SET key_wrapped_vault = $1, key_nonce_vault = $2 WHERE id = $3`,
    [a!.key!.wrapped, a!.key!.nonce, a!.id],
  );
});

test('unsharing takes effect on the next request and removes the key from the database', async () => {
  expect(await status(mira.listMedia({ vaultId: familyVault }))).toBe(200);
  await owner.call('DELETE', `/vaults/${familyVault}/members/${mira.id}`);

  expect(await status(mira.listMedia({ vaultId: familyVault }))).toBe(403);
  expect(await status(mira.upload(familyVault, 'after-unshare.jpg'))).toBe(403);
  expect((await mira.vaults())).toEqual([]);
  expect((await db.query('SELECT 1 FROM vault_members WHERE user_id = $1', [mira.id])).rowCount).toBe(0);
});

test('restricting a user cuts them off at once and deletes every key shared with them', async () => {
  expect(await status(dev.listMedia({ albumId: tripAlbum }))).toBe(200);
  expect(await status(owner.call('PATCH', `/users/${owner.id}`, { status: 'restricted' }))).toBe(403);

  await owner.call('PATCH', `/users/${dev.id}`, { status: 'restricted' });

  // The access token dev already holds is refused, and no new session can start
  expect(await status(dev.listMedia({ albumId: tripAlbum }))).toBe(401);
  expect(await status(dev.call('GET', '/me'))).toBe(401);
  expect(await status(api('POST', '/auth/refresh', { body: { refreshToken: dev.refreshToken } }))).toBe(401);
  expect(await status(dev.signIn())).toBe(403);

  expect((await db.query('SELECT 1 FROM album_members WHERE user_id = $1', [dev.id])).rowCount).toBe(0);
  expect((await db.query('SELECT 1 FROM refresh_tokens WHERE user_id = $1 AND NOT is_revoked', [dev.id])).rowCount).toBe(0);
  // Their own vault is untouched, just unreachable
  expect((await db.query(`SELECT 1 FROM vault_members WHERE user_id = $1 AND role = 'creator'`, [dev.id])).rowCount).toBe(1);

  // Lifting the restriction restores sign-in, not what was shared
  await owner.call('PATCH', `/users/${dev.id}`, { status: 'active' });
  await dev.signIn();
  expect(await dev.sharedAlbums()).toEqual([]);
  expect(await status(dev.listMedia({ albumId: tripAlbum }))).toBe(404);
  expect((await dev.vaults()).map((v) => v.id)).toEqual([devVault]);
});

test('changing a limited user to full access lets them create vaults', async () => {
  await owner.call('PATCH', `/users/${mira.id}`, { accessLevel: 'full' });
  expect(await status(mira.createVault('mira vault passphrase', 'Mine'))).toBe(200);
  await owner.call('PATCH', `/users/${mira.id}`, { accessLevel: 'limited' });
  expect(await status(mira.createVault('another passphrase here', 'Second'))).toBe(403);
  // What they already created stays theirs
  expect((await mira.vaults())).toHaveLength(1);
});

test('no key is stored unwrapped anywhere in the database', async () => {
  // Every key column holds ciphertext longer than the 32-byte key it wraps:
  // sealed keys carry an ephemeral key, IV and tag; AES-wrapped keys carry a tag
  const { rows: vaultKeys } = await db.query('SELECT wrapped_key FROM vault_members');
  const { rows: albumKeys } = await db.query('SELECT key_wrapped FROM albums WHERE key_wrapped IS NOT NULL');
  const { rows: mediaKeys } = await db.query('SELECT key_wrapped_vault FROM media WHERE key_wrapped_vault IS NOT NULL');
  const { rows: albumMediaKeys } = await db.query('SELECT key_wrapped FROM album_media WHERE key_wrapped IS NOT NULL');
  expect(vaultKeys.length).toBeGreaterThan(0);
  for (const row of vaultKeys) expect(b64decode(row.wrapped_key).length).toBeGreaterThanOrEqual(32 + 12 + 32 + 16);
  for (const row of [...albumKeys, ...albumMediaKeys]) expect(b64decode(row.key_wrapped).length).toBe(48);
  for (const row of mediaKeys) expect(b64decode(row.key_wrapped_vault).length).toBe(48);

  const { rows: users } = await db.query('SELECT encrypted_private_keys FROM users');
  for (const row of users) expect(Buffer.from(row.encrypted_private_keys, 'base64').toString('latin1')).not.toContain('encSk');
});
