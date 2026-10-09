import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, request as apiRequest, test, type BrowserContext, type Page } from '@playwright/test';
import { API_URL, OWNER } from './env';
import { FakeStorage } from './fakeStorage';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const FIXTURES = ['march.jpg', 'portrait.png', 'wide.webp'];

test.describe.configure({ mode: 'serial' });

// One storage per browser project: what the owner uploads, the invited viewer must be able to read
const storage = new FakeStorage();
let context: BrowserContext;
let page: Page;
let project: string;
let passphrase: string;
let familyLabel: string;
let workLabel: string;
let inviteCode: string;
const problems: string[] = [];

function watch(target: Page): void {
  target.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  target.on('console', (message) => {
    if (/content security policy|refused to (load|connect|execute|create)/i.test(message.text())) {
      problems.push(`csp: ${message.text()}`);
    }
  });
}

async function newSession(browser: import('@playwright/test').Browser): Promise<{ context: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  await storage.attach(ctx);
  const p = await ctx.newPage();
  watch(p);
  return { context: ctx, page: p };
}

async function login(target: Page, deviceId: string, password: string): Promise<void> {
  await target.goto('/login');
  await target.getByLabel('Device ID', { exact: true }).fill(deviceId);
  await target.getByLabel('Password', { exact: true }).fill(password);
  await target.getByRole('button', { name: 'Login' }).click();
  await expect(target).toHaveURL(/\/unlock$/);
}

async function enterPassphrase(target: Page, value: string): Promise<void> {
  await target.getByLabel('Vault passphrase', { exact: true }).fill(value);
  await target.getByRole('button', { name: 'Unlock' }).click();
}

// Scoped to the photo grid: navigation and the upload panel have list items of their own
const tiles = (target: Page) => target.getByRole('list', { name: 'Photos' }).getByRole('listitem');

/** Every tile has finished decrypting and is showing a real image. */
async function expectTilesDecrypted(target: Page, count: number): Promise<void> {
  await expect(tiles(target)).toHaveCount(count);
  await expect
    .poll(() =>
      target
        .locator('[role=list][aria-label=Photos] img')
        .evaluateAll((images) => images.filter((img) => (img as HTMLImageElement).naturalWidth > 0).length),
    )
    .toBe(count);
}

async function openSection(target: Page, name: 'Timeline' | 'Albums' | 'Settings'): Promise<void> {
  await target.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name }).click();
  await expect(target.getByRole('heading', { level: 1, name })).toBeVisible();
}

test.beforeAll(async ({ browser }, testInfo) => {
  project = testInfo.project.name;
  passphrase = `e2e shared passphrase ${project}`;
  familyLabel = `Family ${project}`;
  workLabel = `Work ${project}`;
  ({ context, page } = await newSession(browser));
});

test.afterAll(async () => {
  await context?.close();
});

test('owner signs in and creates a vault', async () => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await login(page, OWNER.deviceId, OWNER.password);

  await page.getByRole('button', { name: 'Create a vault' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a vault' });
  await dialog.getByLabel('Name', { exact: true }).fill(familyLabel);
  await dialog.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await dialog.getByLabel('Confirm passphrase', { exact: true }).fill(passphrase);
  await dialog.getByRole('button', { name: 'Create vault' }).click();

  // The new vault opens straight away, without asking for the passphrase again
  await expect(page).toHaveURL(/\/timeline$/);
  await expect(page.getByTestId('vault-label')).toHaveText(familyLabel);
  await expect(page.getByRole('heading', { name: 'No photos yet' })).toBeVisible();
});

test('uploads are encrypted in the browser and show up decrypted', async () => {
  await page.getByTestId('upload-input').setInputFiles(FIXTURES.map(fixture));
  await expect(page.getByTestId('upload-panel').getByRole('status')).toHaveText('3 uploaded', { timeout: 60_000 });

  await expectTilesDecrypted(page, 3);
  // The JPEG carries an EXIF date, so it is filed under its own month
  await expect(page.getByRole('heading', { level: 2, name: 'March 2024' })).toBeVisible();

  // What reached storage is ciphertext: three tiers per file, none of them readable
  const originals = storage.keys().filter((key) => key.endsWith('/original.enc'));
  expect(originals.length).toBeGreaterThanOrEqual(3);
  const plaintexts = FIXTURES.map((name) => readFileSync(fixture(name)));
  for (const key of originals) {
    const stored = storage.get(key)!;
    for (const plain of plaintexts) {
      expect(stored.equals(plain)).toBe(false);
      expect(stored.includes(plain.subarray(0, 64))).toBe(false);
    }
  }
  const sizes = originals.map((key) => storage.get(key)!.length).sort();
  // ciphertext = plaintext + 16-byte authentication tag
  expect(sizes).toEqual(expect.arrayContaining(plaintexts.map((plain) => plain.length + 16)));

  await page.getByTestId('upload-panel').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('upload-panel')).toBeHidden();
});

test('viewer: decrypt, navigate, zoom, like, details and download', async () => {
  await tiles(page).first().getByRole('button', { name: /^(Photo|Video)/ }).click();
  const viewer = page.getByTestId('viewer');
  await expect(viewer).toBeVisible();
  await expect(page).toHaveURL(/[?&]v=[0-9a-f-]{36}/);

  const image = page.getByTestId('viewer-image');
  await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

  // Arrow keys step through the list without tabbing into the viewer first.
  // Each step waits for the viewer itself to show the new photo, not just the URL.
  const firstId = new URL(page.url()).searchParams.get('v')!;
  await expect(viewer).toHaveAttribute('data-item-id', firstId);
  await page.keyboard.press('ArrowRight');
  await expect(viewer).not.toHaveAttribute('data-item-id', firstId);
  const secondId = (await viewer.getAttribute('data-item-id'))!;
  expect(new URL(page.url()).searchParams.get('v')).toBe(secondId);
  await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('ArrowLeft');
  await expect(viewer).toHaveAttribute('data-item-id', firstId);
  expect(new URL(page.url()).searchParams.get('v')).toBe(firstId);

  const layer = page.getByTestId('viewer-stage').locator('> div');
  await page.keyboard.press('+');
  await expect.poll(() => layer.evaluate((el) => (el as HTMLElement).style.transform)).toContain('scale(1.5)');
  await page.keyboard.press('0');
  await expect.poll(() => layer.evaluate((el) => (el as HTMLElement).style.transform)).toContain('scale(1)');

  await page.keyboard.press('l');
  await expect(viewer.getByRole('button', { name: 'Unlike' })).toHaveAttribute('aria-pressed', 'true');

  // The file name only exists inside the encrypted metadata
  await page.keyboard.press('i');
  const details = viewer.getByRole('complementary', { name: 'Details' });
  await expect(details).toBeVisible();
  const filename = (await details.locator('dt', { hasText: 'File name' }).locator('+ dd').innerText()).trim();
  expect(FIXTURES).toContain(filename);

  // The downloaded original is byte-for-byte the file that was uploaded
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('d')]);
  expect(download.suggestedFilename()).toBe(filename);
  // saveAs rather than path(): it also works when the browser runs on another machine
  const saved = test.info().outputPath(`downloaded-${filename}`);
  await download.saveAs(saved);
  expect(readFileSync(saved).equals(readFileSync(fixture(filename)))).toBe(true);

  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(page).toHaveURL(/\/timeline$/);
  await expectTilesDecrypted(page, 3);
});

test('liked album follows the heart', async () => {
  await openSection(page, 'Albums');
  const liked = page.getByRole('link', { name: /Liked/ });
  await expect(liked).toContainText('1 item');
  await liked.click();
  await expect(page.getByRole('heading', { level: 1, name: 'Liked' })).toBeVisible();
  await expectTilesDecrypted(page, 1);

  await tiles(page).first().getByRole('button', { name: /^(Photo|Video)/ }).click();
  await expect(page.getByTestId('viewer')).toBeVisible();
  await page.keyboard.press('l');
  await expect(page.getByTestId('viewer').getByRole('button', { name: 'Like', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(page.getByRole('heading', { name: 'No liked photos yet' })).toBeVisible();
});

test('owner files photos into an album, removes one and renames it', async () => {
  await openSection(page, 'Albums');
  await page.getByRole('button', { name: 'New album' }).click();
  const create = page.getByRole('dialog', { name: 'New album' });
  await create.getByLabel('Album name').fill('Trip');
  await create.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.getByRole('link', { name: /Trip/ })).toContainText('0 items');

  await openSection(page, 'Timeline');
  await expectTilesDecrypted(page, 3);
  await tiles(page).nth(0).hover();
  await tiles(page).nth(0).getByRole('checkbox').click();
  // With a selection in progress, clicking a photo selects it instead of opening it
  await tiles(page).nth(1).getByRole('button', { name: /^(Photo|Video)/ }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Selection' });
  await expect(toolbar).toContainText('2 selected');

  await toolbar.getByRole('button', { name: 'Add to album' }).click();
  await page.getByRole('dialog', { name: 'Add to album' }).getByRole('button', { name: /Trip/ }).click();
  await expect(page.getByText('Added 2 items to Trip')).toBeVisible();
  await expect(toolbar).toBeHidden();

  await openSection(page, 'Albums');
  const trip = page.getByRole('link', { name: /Trip/ });
  await expect(trip).toContainText('2 items');
  // The cover is one of the album's photos, decrypted
  await expect.poll(() => trip.locator('img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await trip.click();
  await expectTilesDecrypted(page, 2);

  await tiles(page).nth(0).hover();
  await tiles(page).nth(0).getByRole('checkbox').click();
  await page.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('Removed 1 item from Trip')).toBeVisible();
  await expectTilesDecrypted(page, 1);

  await page.getByRole('button', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename album' });
  await rename.getByLabel('Album name').fill('Road trip');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Road trip' })).toBeVisible();
});

test('dropping a file on an album uploads it into that album', async () => {
  // Still on the "Road trip" album from the previous step
  const bytes = readFileSync(fixture('wide.webp')).toString('base64');
  const dataTransfer = await page.evaluateHandle((b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([data], 'dropped.webp', { type: 'image/webp', lastModified: Date.now() }));
    return transfer;
  }, bytes);

  await page.dispatchEvent('body', 'dragenter', { dataTransfer });
  await expect(page.getByText('Drop to upload')).toBeVisible();
  await expect(page.getByText(/Into Road trip/)).toBeVisible();
  await page.dispatchEvent('body', 'drop', { dataTransfer });

  await expect(page.getByTestId('upload-panel').getByRole('status')).toHaveText('1 uploaded', { timeout: 60_000 });
  await expectTilesDecrypted(page, 2);
  await page.getByTestId('upload-panel').getByRole('button', { name: 'Dismiss' }).click();
});

test('owner creates an invite code', async () => {
  await openSection(page, 'Settings');
  await page.getByRole('button', { name: 'Create code' }).click();
  const code = page.getByTestId('invite-code');
  await expect(code).toBeVisible();
  inviteCode = (await code.innerText()).trim();
  expect(inviteCode).toMatch(/^[0-9a-f]{64}$/);
  await page.getByRole('button', { name: 'Done' }).click();
});

test('an invited device can view but not manage', async ({ browser }) => {
  const viewerDevice = { deviceId: `e2e-viewer-${project}`, password: 'Viewer-Passw0rd!-e2e' };
  const session = await newSession(browser);
  const viewer = session.page;

  await viewer.goto('/register');
  await viewer.getByLabel('Device name', { exact: true }).fill(`Viewer ${project}`);
  await viewer.getByLabel('Device ID', { exact: true }).fill(viewerDevice.deviceId);

  // Password rules are checked before anything is sent
  await viewer.getByLabel('Password', { exact: true }).fill('short');
  await viewer.getByRole('button', { name: 'Register' }).click();
  await expect(viewer.getByText(/Needs: at least 12 characters/)).toBeVisible();

  await viewer.getByLabel('Password', { exact: true }).fill(viewerDevice.password);
  await viewer.getByLabel('Invite code', { exact: true }).fill(inviteCode);
  await viewer.getByRole('button', { name: 'Register' }).click();
  await expect(viewer).toHaveURL(/\/unlock$/);

  // Non-owners are not offered vault creation
  await expect(viewer.getByRole('button', { name: 'Create a vault' })).toHaveCount(0);

  await enterPassphrase(viewer, passphrase);
  await expect(viewer).toHaveURL(/\/timeline$/);
  await expectTilesDecrypted(viewer, 4);

  await expect(viewer.getByRole('button', { name: 'Upload' })).toHaveCount(0);
  await expect(viewer.getByTestId('upload-input')).toHaveCount(0);
  await tiles(viewer).first().hover();
  await expect(viewer.getByRole('checkbox')).toHaveCount(0);

  await openSection(viewer, 'Settings');
  await expect(viewer.getByText('Owner tools')).toHaveCount(0);

  // The server refuses too, whatever a client shows
  const api = await apiRequest.newContext();
  const tokens = await (
    await api.post(`${API_URL}/auth/login`, { data: viewerDevice })
  ).json();
  const vaults = await (
    await api.get(`${API_URL}/vaults`, { headers: { Authorization: `Bearer ${tokens.data.accessToken}` } })
  ).json();
  const refused = await api.post(`${API_URL}/media/upload/init`, {
    headers: { Authorization: `Bearer ${tokens.data.accessToken}` },
    data: { vaultId: vaults.data[0].id, mediaType: 'photo' },
  });
  expect(refused.status()).toBe(403);
  await api.dispose();

  // Logging this device out ...
  await viewer.getByRole('button', { name: 'Logout' }).click();
  await expect(viewer).toHaveURL(/\/login$/);
  await session.context.close();

  // ... leaves the owner's session alone
  await page.reload();
  await expect(page).toHaveURL(/\/unlock$/);
});

test('a reload keeps the sign-in but always asks for the passphrase', async () => {
  // The previous step reloaded on Settings: signed in (refresh cookie), keys gone
  await expect(page.getByRole('heading', { name: 'Enter Passphrase' })).toBeVisible();

  await enterPassphrase(page, `${passphrase} wrong`);
  await expect(page.getByText('Invalid passphrase')).toBeVisible();
  await expect(page.getByLabel('Vault passphrase', { exact: true })).toHaveValue('');

  await enterPassphrase(page, passphrase);
  // Back to the screen that was open before the reload
  await expect(page).toHaveURL(/\/settings$/);
});

test('locking removes decrypted media from the page', async () => {
  await openSection(page, 'Timeline');
  await expectTilesDecrypted(page, 4);
  // Thumbnails are in-memory object URLs, never data written to storage
  expect(await tiles(page).first().locator('img').getAttribute('src')).toMatch(/^blob:/);

  await page.getByRole('button', { name: 'Lock vault' }).click();
  await expect(page).toHaveURL(/\/unlock$/);
  await expect(page.locator('img')).toHaveCount(0);

  await enterPassphrase(page, passphrase);
  await expect(page).toHaveURL(/\/timeline$/);
  await expectTilesDecrypted(page, 4);
});

test('the same account can be signed in twice; logging out one keeps the other', async ({ browser }) => {
  const second = await newSession(browser);
  await login(second.page, OWNER.deviceId, OWNER.password);
  await second.page.getByRole('button', { name: 'Logout' }).click();
  await expect(second.page).toHaveURL(/\/login$/);
  await second.context.close();

  await page.reload();
  await expect(page).toHaveURL(/\/unlock$/);
  await enterPassphrase(page, passphrase);
  await expect(page).toHaveURL(/\/timeline$/);
});

test('one passphrase on two vaults offers a choice of exactly those vaults', async () => {
  await openSection(page, 'Settings');
  await page.getByRole('button', { name: 'New vault' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a vault' });
  await dialog.getByLabel('Name', { exact: true }).fill(workLabel);
  await dialog.getByLabel('Passphrase', { exact: true }).fill(passphrase);
  await dialog.getByLabel('Confirm passphrase', { exact: true }).fill(passphrase);
  await dialog.getByRole('button', { name: 'Create vault' }).click();
  await expect(page.getByText(`Created ${workLabel}.`, { exact: false })).toBeVisible();
  // Creating a vault from Settings does not switch vaults
  await expect(page.getByTestId('vault-label')).toHaveText(familyLabel);

  await page.getByRole('button', { name: 'Lock now' }).click();
  await enterPassphrase(page, passphrase);

  const picker = page.getByRole('dialog', { name: 'Select vault' });
  await expect(picker).toBeVisible();
  // Other browsers' vaults exist on this server too; only the two that matched are listed
  await expect(picker.getByRole('listitem')).toHaveCount(2);
  await picker.getByRole('button', { name: workLabel }).click();

  await expect(page.getByTestId('vault-label')).toHaveText(workLabel);
  await openSection(page, 'Timeline');
  await expect(page.getByRole('heading', { name: 'No photos yet' })).toBeVisible();

  // Dismissing the picker opens nothing
  await page.getByRole('button', { name: 'Lock vault' }).click();
  await enterPassphrase(page, passphrase);
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(page).toHaveURL(/\/unlock$/);

  await enterPassphrase(page, passphrase);
  await picker.getByRole('button', { name: familyLabel }).click();
  await expect(page.getByTestId('vault-label')).toHaveText(familyLabel);
  await expectTilesDecrypted(page, 4);
});

test('expired download links are renewed without the user noticing', async () => {
  await openSection(page, 'Settings');
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await expect(page.getByText('Cache cleared')).toBeVisible();

  // With the cache empty every thumbnail must be fetched again, and every link the
  // page is holding now answers 403. (Links are stamped to the second, so step
  // into the next one first.)
  await page.waitForTimeout(1100);
  storage.expireExistingLinks();
  await openSection(page, 'Timeline');
  await expectTilesDecrypted(page, 4);

  // The viewer asks for its links at the moment of use, so it is unaffected
  await tiles(page).first().getByRole('button', { name: /^(Photo|Video)/ }).click();
  const image = page.getByTestId('viewer-image');
  await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('viewer')).toBeHidden();
});

test('media links cannot be requested through a different vault', async () => {
  const api = await apiRequest.newContext();
  const tokens = await (
    await api.post(`${API_URL}/auth/login`, { data: { deviceId: OWNER.deviceId, password: OWNER.password } })
  ).json();
  const headers = { Authorization: `Bearer ${tokens.data.accessToken}` };
  const vaults: { id: string }[] = (await (await api.get(`${API_URL}/vaults`, { headers })).json()).data;

  let filled: { vaultId: string; mediaId: string } | undefined;
  let empty: string | undefined;
  for (const vault of vaults) {
    const media = (await (await api.get(`${API_URL}/media?vaultId=${vault.id}&limit=1`, { headers })).json()).data;
    if (media.total > 0) filled ??= { vaultId: vault.id, mediaId: media.data[0].id };
    else empty ??= vault.id;
  }
  expect(filled).toBeDefined();
  expect(empty).toBeDefined();

  const own = await api.get(`${API_URL}/media/${filled!.mediaId}/urls?vaultId=${filled!.vaultId}`, { headers });
  expect(own.status()).toBe(200);
  // The owner has access to both vaults, but this photo is not in the second one
  const crossed = await api.get(`${API_URL}/media/${filled!.mediaId}/urls?vaultId=${empty}`, { headers });
  expect(crossed.status()).toBe(404);
  await api.dispose();
});

test('theme choice applies and survives a reload', async () => {
  await openSection(page, 'Settings');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await enterPassphrase(page, passphrase);
  await picker(page, familyLabel);
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('logout returns to sign-in and nothing broke along the way', async () => {
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);
  // The device ID is remembered for next time; the password never is
  await expect(page.getByLabel('Device ID', { exact: true })).toHaveValue(OWNER.deviceId);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');

  // A signed-out reload stays signed out
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);

  // No script errors and no content-security-policy violations in the whole journey
  expect(problems).toEqual([]);
});

/** Two vaults share the passphrase by now, so unlocking always asks which one. */
async function picker(target: Page, label: string): Promise<void> {
  await target.getByRole('dialog', { name: 'Select vault' }).getByRole('button', { name: label }).click();
  await expect(target.getByTestId('vault-label')).toHaveText(label);
}
