// The web client's half of the app interop check, using the same Keyring the
// browser runs.
//
//   seed    create the owner, vaults, albums and photos, as the web would,
//           and delete some of them again
//   verify  open what the mobile app created and check every byte, and
//           check that what the app deleted is gone
import { createHash } from 'node:crypto';
import { b64decode } from '../../src/lib/crypto/base64';
import { ApiUser } from '../e2e/apiUser';
import { OWNER, SETUP_KEY } from '../e2e/env';
import { KEYS_PATH } from '../e2e/memoryStorage';
import { STORAGE_PORT } from './ports';

// Shared with app/integration_test/interop_test.dart
const WEB_VAULT = { passphrase: 'made on the web passphrase', label: 'Web vault' };
const WEB_ALBUM = 'Web album';
const WEB_FILE = 'from-web.png';
// For the app to delete: a photo, an album, and a whole vault
const DOOMED_FILE = 'delete-me.png';
const DOOMED_ALBUM = 'Doomed album';
const DOOMED_VAULT = { passphrase: 'doomed vault passphrase', label: 'Doomed vault' };
const APP_VAULT = { passphrase: 'made in the app passphrase', label: 'App vault' };
const APP_ALBUM = 'App album';
// A 4×4 red PNG: something the app can really decode and show
const PIXEL = b64decode('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGM4YWMDRwzEcQAREhQBbrqBkwAAAABJRU5ErkJggg==');

function check(condition: unknown, what: string): asserts condition {
  if (!condition) throw new Error(`FAILED: ${what}`);
  console.log(`  ok  ${what}`);
}

async function put(url: string, data: ArrayBuffer): Promise<void> {
  const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: data });
  if (!res.ok) throw new Error(`storage ${res.status}`);
}

/** Upload one photo the way the web client does, files included. */
async function upload(
  owner: ApiUser,
  vaultId: string,
  filename: string,
  capturedAt: string,
  albumId?: string,
): Promise<string> {
  const init = await owner.call<{ mediaId: string; uploadUrls: Record<'thumb' | 'preview' | 'original', string> }>(
    'POST', '/media/upload/init', { vaultId, mediaType: 'photo', ...(albumId ? { albumId } : {}) },
  );
  const copy = () => PIXEL.slice().buffer as ArrayBuffer;
  const encrypted = await owner.keyring.encryptMedia({
    mediaId: init.mediaId, vaultId, albumId, thumb: copy(), preview: copy(), original: copy(),
    meta: { filename, gpsLatitude: 48.85837, gpsLongitude: 2.29448 },
  });
  await put(init.uploadUrls.thumb, encrypted.thumb.data);
  await put(init.uploadUrls.preview, encrypted.preview.data);
  await put(init.uploadUrls.original, encrypted.original.data);
  await owner.call('POST', '/media/upload/complete', {
    mediaId: init.mediaId, vaultId, mediaType: 'photo', capturedAt, width: 4, height: 4,
    keyWrappedVault: encrypted.vaultKey!.wrapped, keyNonceVault: encrypted.vaultKey!.nonce,
    ...(albumId ? { albumId, keyWrappedAlbum: encrypted.albumKey!.wrapped, keyNonceAlbum: encrypted.albumKey!.nonce } : {}),
    thumbIv: encrypted.thumb.iv, previewIv: encrypted.preview.iv, originalIv: encrypted.original.iv,
    encryptedMeta: encrypted.encryptedMeta, metaNonce: encrypted.metaNonce,
  });
  return init.mediaId;
}

const storedKeys = async (): Promise<string[]> =>
  (await (await fetch(`http://127.0.0.1:${STORAGE_PORT}${KEYS_PATH}`)).json()) as string[];

/** Deleted files are erased just after the request returns. */
async function untilStored(count: number): Promise<number> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await storedKeys()).length === count) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return (await storedKeys()).length;
}

async function seed(): Promise<void> {
  const owner = await ApiUser.setup(SETUP_KEY, OWNER);
  const vaultId = await owner.createVault(WEB_VAULT.passphrase, WEB_VAULT.label);
  const albumId = await owner.createAlbum(vaultId, WEB_ALBUM);
  await upload(owner, vaultId, WEB_FILE, '2024-03-05T10:30:00.000Z', albumId);

  // What the web client deletes must be gone for the app: a photo and an album
  const gone = await upload(owner, vaultId, 'deleted-on-the-web.png', '2024-03-06T10:30:00.000Z');
  const goneAlbum = await owner.createAlbum(vaultId, 'Deleted on the web');
  await owner.call('POST', '/media/delete', { ids: [gone] });
  await owner.call('DELETE', `/albums/${goneAlbum}`);

  // What the app will delete: a photo (older, so it sorts second), an album, a vault
  await upload(owner, vaultId, DOOMED_FILE, '2024-03-01T10:30:00.000Z');
  await owner.createAlbum(vaultId, DOOMED_ALBUM);
  const doomedVault = await owner.createVault(DOOMED_VAULT.passphrase, DOOMED_VAULT.label);
  await upload(owner, doomedVault, 'in-the-doomed-vault.png', '2024-03-05T10:30:00.000Z');

  // Three photos are left, three files each
  check((await untilStored(9)) === 9, 'the photo deleted on the web is erased from storage');
  console.log('seeded: owner, two vaults, albums and photos made with the web client');
}

/** Width and height from a JPEG's frame header. */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  for (let i = 2; i + 9 < bytes.length; ) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! };
    }
    i += 2 + length;
  }
  return null;
}

async function verify(): Promise<void> {
  const owner = await ApiUser.signIn(OWNER);
  console.log('web client reading what the app made:');

  const opened = await owner.openOwnVaults(APP_VAULT.passphrase);
  check(opened.length === 1 && opened[0] === APP_VAULT.label, `the app's vault opens with its passphrase and is named "${APP_VAULT.label}"`);
  check((await owner.openOwnVaults('not the passphrase')).length === 0, 'a wrong passphrase opens nothing');

  // Only the vault that passphrase opened can be read; the web-made one stays shut
  let vaultId = '';
  for (const vault of (await owner.vaults()).filter((v) => v.role === 'creator')) {
    try {
      await owner.openAlbums(vault.id);
      check(vaultId === '', 'exactly one vault is open');
      vaultId = vault.id;
    } catch {
      // locked: not the one this passphrase opened
    }
  }
  check(vaultId !== '', 'the opened vault can be read');

  const names = await owner.openAlbums(vaultId);
  const album = [...names.entries()].find(([, name]) => name === APP_ALBUM);
  check(album, `the app's album name decrypts to "${APP_ALBUM}"`);

  const rows = await owner.listMedia({ vaultId });
  check(rows.length === 1, 'the vault holds the one photo the app uploaded');
  const row = rows[0]!;
  const inAlbum = await owner.listMedia({ vaultId, albumId: album[0] });
  check(inAlbum.length === 1 && inAlbum[0]!.id === row.id, 'the photo is in the album it was uploaded into');

  const [filename] = await owner.filenames(rows);
  check(typeof filename === 'string' && /^fixture-[0-9a-f]{64}\.png$/.test(filename), `the file name decrypts (${filename})`);
  const expectedHash = filename.slice('fixture-'.length, -'.png'.length);

  const full = (await owner.call<{ data: Array<Record<string, unknown>> }>('GET', `/media?vaultId=${vaultId}`)).data[0]!;
  const links = await owner.call<{ previewUrl: string; originalUrl: string; previewIv: string; originalIv: string }>(
    'GET', `/media/${row.id}/urls`,
  );
  const fetchBlob = async (url: string) => (await (await fetch(url)).arrayBuffer());
  const key = owner.keyRef(row)!;
  const decrypt = async (tier: 'thumb' | 'preview' | 'original', url: string, iv: string) =>
    new Uint8Array(await owner.keyring.decryptBlob({ mediaId: row.id, tier, key, iv, data: await fetchBlob(url) }));

  const original = await decrypt('original', links.originalUrl, links.originalIv);
  check(createHash('sha256').update(original).digest('hex') === expectedHash, `the original decrypts to the exact file the app picked (${original.length} bytes)`);

  const preview = jpegSize(await decrypt('preview', links.previewUrl, links.previewIv));
  check(preview && Math.min(preview.width, preview.height) === 1080, `the preview is a JPEG with its shortest edge at 1080 (${preview?.width}×${preview?.height})`);
  const thumb = jpegSize(await decrypt('thumb', full.thumbUrl as string, row.thumbIv));
  check(thumb && Math.min(thumb.width, thumb.height) === 200, `the thumbnail is a JPEG with its shortest edge at 200 (${thumb?.width}×${thumb?.height})`);
  check(full.width === 1600 && full.height === 1200, `the app reported the photo's size (${full.width}×${full.height})`);

  let swapped = false;
  try {
    await owner.keyring.decryptBlob({ mediaId: row.id, tier: 'thumb', key, iv: links.previewIv, data: await fetchBlob(links.previewUrl) });
  } catch {
    swapped = true;
  }
  check(swapped, 'a preview cannot be passed off as a thumbnail');
  console.log('web client checking what the app deleted:');
  check((await owner.openOwnVaults(DOOMED_VAULT.passphrase)).length === 0, 'the vault the app deleted no longer opens with its passphrase');
  check((await owner.vaults()).filter((v) => v.role === 'creator').length === 2, 'two vaults are left: the web-made one and the app-made one');

  const webOpened = await owner.openOwnVaults(WEB_VAULT.passphrase);
  check(webOpened.length === 1 && webOpened[0] === WEB_VAULT.label, 'the web-made vault still opens');
  let webVaultId = '';
  for (const vault of (await owner.vaults()).filter((v) => v.role === 'creator' && v.id !== vaultId)) webVaultId = vault.id;
  const webAlbums = [...(await owner.openAlbums(webVaultId)).values()].filter((name) => name !== null);
  check(webAlbums.length === 1 && webAlbums[0] === WEB_ALBUM, `only "${WEB_ALBUM}" is left of its albums (${webAlbums.join(', ')})`);
  const webRows = await owner.listMedia({ vaultId: webVaultId });
  const webNames = await owner.filenames(webRows);
  check(webNames.length === 1 && webNames[0] === WEB_FILE, `only ${WEB_FILE} is left of its photos (${webNames.join(', ')})`);

  // Two photos exist anywhere now, three files each
  const stored = await untilStored(6);
  check(stored === 6, `storage holds only the files of the two photos that are left (${stored} files)`);
  check((await storedKeys()).every((key) => key.includes(`/${vaultId}/`) || key.includes(`/${webVaultId}/`)), 'no file of the deleted vault is left in storage');
  console.log('all checks passed');
}

const command = process.argv[2];
await (command === 'seed' ? seed() : command === 'verify' ? verify() : Promise.reject(new Error('seed | verify')));
