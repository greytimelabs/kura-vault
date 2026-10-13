import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { ApiError, ApiUser } from './apiUser';
import { OWNER } from './env';
import { FakeStorage } from './fakeStorage';

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const FIXTURES = ['march.jpg', 'portrait.png', 'wide.webp'];

test.describe.configure({ mode: 'serial' });

// One storage per browser project: what the owner uploads, the people it is shared with must be able to read
const storage = new FakeStorage();
let context: BrowserContext;
let page: Page;
let project: string;
let passphrase: string;
let familyLabel: string;
let workLabel: string;
const MEMBER_PASSWORD = 'Member-Passw0rd!-e2e';
const MEMBER_PASSPHRASE = 'member master passphrase for e2e';
let memberName: string;
let member: { context: BrowserContext; page: Page };
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

async function login(target: Page, username: string, password: string): Promise<void> {
  await target.goto('/login');
  await target.getByLabel('Username', { exact: true }).fill(username);
  await target.getByLabel('Password', { exact: true }).fill(password);
  await target.getByRole('button', { name: 'Login' }).click();
  await expect(target).toHaveURL(/\/unlock$/);
}

/** The master passphrase: loads the account's keys and shows what can be opened. */
async function unlock(target: Page, value: string): Promise<void> {
  await target.getByLabel('Master passphrase', { exact: true }).fill(value);
  await target.getByRole('button', { name: 'Unlock' }).click();
}

/** A vault passphrase, on the screen that follows the master passphrase. */
async function enterPassphrase(target: Page, value: string): Promise<void> {
  await target.getByLabel('Vault passphrase', { exact: true }).fill(value);
  await target.getByRole('button', { name: 'Open', exact: true }).click();
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

test('owner signs in, unlocks and creates a vault', async () => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
  await login(page, OWNER.username, OWNER.password);

  // Nothing about any vault is shown before the master passphrase
  await expect(page.getByRole('button', { name: 'Create a vault' })).toHaveCount(0);
  await unlock(page, `${OWNER.passphrase} wrong`);
  await expect(page.getByText('Invalid passphrase')).toBeVisible();
  await unlock(page, OWNER.passphrase);
  await expect(page.getByRole('heading', { name: 'Open a vault' })).toBeVisible();

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

test('the owner adds a user, who joins from the invite link with their own secrets', async ({ browser }) => {
  memberName = `e2e-member-${project}`;
  await openSection(page, 'Settings');
  await page.getByRole('button', { name: 'Manage users' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Users' })).toBeVisible();

  await page.getByRole('button', { name: 'Add user' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Username', { exact: true }).fill(memberName);
  await dialog.getByRole('button', { name: 'Create invite link' }).click();
  const link = await dialog.getByTestId('invite-link').inputValue();
  // The secret is in the fragment, which browsers never send to a server
  expect(link).toMatch(/\/join#v1\.[A-Za-z0-9_-]+$/);
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText('has not joined yet')).toBeVisible();

  const session = await newSession(browser);
  member = session;
  const joiner = session.page;
  await joiner.goto(link);
  await expect(joiner.getByTestId('join-username')).toHaveText(memberName);
  // The secret leaves the address bar as soon as it has been read
  expect(new URL(joiner.url()).hash).toBe('');

  // Rules are checked before anything is sent, and the two secrets must differ
  await joiner.getByLabel('Password', { exact: true }).fill('short');
  await joiner.getByRole('button', { name: 'Create account' }).click();
  await expect(joiner.getByText(/At least 12 characters/)).toBeVisible();
  await joiner.getByLabel('Password', { exact: true }).fill(MEMBER_PASSWORD);
  await joiner.getByLabel('Confirm password', { exact: true }).fill(MEMBER_PASSWORD);
  await joiner.getByLabel('Master passphrase', { exact: true }).fill(MEMBER_PASSWORD);
  await joiner.getByLabel('Confirm master passphrase', { exact: true }).fill(MEMBER_PASSWORD);
  await joiner.getByRole('button', { name: 'Create account' }).click();
  await expect(joiner.getByText('Must be different from the password')).toBeVisible();

  await joiner.getByLabel('Master passphrase', { exact: true }).fill(MEMBER_PASSPHRASE);
  await joiner.getByLabel('Confirm master passphrase', { exact: true }).fill(MEMBER_PASSPHRASE);
  await joiner.getByRole('button', { name: 'Create account' }).click();

  // Signed in and unlocked. A limited user has no vaults to create and nothing shared yet
  await expect(joiner).toHaveURL(/\/unlock$/);
  await expect(joiner.getByText('Nothing has been shared with you yet')).toBeVisible();
  await expect(joiner.getByRole('button', { name: 'Create a vault' })).toHaveCount(0);
  await expect(joiner.getByLabel('Vault passphrase', { exact: true })).toHaveCount(0);
  await expect(joiner.getByRole('link', { name: 'Manage users' })).toHaveCount(0);

  // The link works once
  const again = await newSession(browser);
  await again.page.goto(link);
  await expect(again.page.getByText(/expired or was already used/)).toBeVisible();
  await again.context.close();

  // The owner's client verifies the new keys against the link's secret and signs them
  await page.reload();
  await unlock(page, OWNER.passphrase);
  await page.getByRole('link', { name: 'Manage users' }).click();
  await expect(page.getByTestId(`user-${memberName}`)).toContainText('Keys verified');
});

test('a vault shared view-only opens without its passphrase and cannot be changed', async () => {
  await page.getByRole('link', { name: 'Back' }).click();
  await enterPassphrase(page, passphrase);
  await openSection(page, 'Settings');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: `Share ${familyLabel}` });
  await share.getByLabel('Share with', { exact: true }).selectOption({ label: memberName });
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(share.getByTestId(`member-${memberName}`)).toBeVisible();
  await page.keyboard.press('Escape');

  const viewer = member.page;
  await viewer.reload();
  await unlock(viewer, MEMBER_PASSPHRASE);
  // Listed by name, with who shared it: the key arrived sealed to this user's public key
  const shared = viewer.getByRole('region', { name: 'Shared with you' });
  await expect(shared.getByRole('button')).toHaveCount(1);
  await expect(shared).toContainText(`Vault from ${OWNER.username}`);
  await expect(shared).toContainText('view only');
  await shared.getByRole('button', { name: new RegExp(familyLabel) }).click();

  await expect(viewer).toHaveURL(/\/timeline$/);
  await expectTilesDecrypted(viewer, 4);

  await expect(viewer.getByRole('button', { name: 'Upload' })).toHaveCount(0);
  await expect(viewer.getByTestId('upload-input')).toHaveCount(0);
  await tiles(viewer).first().hover();
  await expect(viewer.getByRole('checkbox')).toHaveCount(0);
  await openSection(viewer, 'Albums');
  await expect(viewer.getByRole('button', { name: 'New album' })).toHaveCount(0);
  await expect(viewer.getByRole('link', { name: /Road trip/ })).toContainText('2 items');
  await openSection(viewer, 'Settings');
  await expect(viewer.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: 'Manage users' })).toHaveCount(0);

  // The server refuses too, whatever a client shows
  const api = await ApiUser.signIn({ username: memberName, password: MEMBER_PASSWORD, passphrase: MEMBER_PASSPHRASE });
  const [vault] = await api.vaults();
  const refused = await api.call('POST', '/media/upload/init', { vaultId: vault!.id, mediaType: 'photo' }).catch((e) => e);
  expect(refused).toBeInstanceOf(ApiError);
  expect((refused as ApiError).status).toBe(403);
});

test('write access lets the user add photos; removing the share ends access at once', async () => {
  const share = page.getByRole('dialog', { name: `Share ${familyLabel}` });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await share.getByLabel(`Permission for ${memberName}`).selectOption('write');
  await expect(page.getByText(`Updated ${memberName}`)).toBeVisible();

  const viewer = member.page;
  await viewer.getByRole('button', { name: 'Close', exact: true }).click();
  // Closing a vault keeps the account unlocked: no master passphrase again
  await expect(viewer.getByRole('region', { name: 'Shared with you' })).toContainText('can add photos');
  await viewer.getByRole('region', { name: 'Shared with you' }).getByRole('button').click();
  await viewer.getByTestId('upload-input').setInputFiles(fixture('march.jpg'));
  await expect(viewer.getByTestId('upload-panel').getByRole('status')).toHaveText('1 uploaded', { timeout: 60_000 });
  await expectTilesDecrypted(viewer, 5);

  await share.getByTestId(`member-${memberName}`).getByRole('button', { name: 'Remove' }).click();
  await expect(share.getByText('Only you.')).toBeVisible();
  await page.keyboard.press('Escape');

  // The server refuses the very next request, and the vault is gone from what they can open
  const api = await ApiUser.signIn({ username: memberName, password: MEMBER_PASSWORD, passphrase: MEMBER_PASSPHRASE });
  expect(await api.vaults()).toEqual([]);
  await viewer.getByRole('button', { name: 'Close vault' }).click();
  await expect(viewer.getByText('Nothing has been shared with you yet')).toBeVisible();
});

test('one album can be shared on its own, and restricting the user signs them out', async () => {
  await openSection(page, 'Albums');
  await page.getByRole('link', { name: /Road trip/ }).click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share Road trip' });
  await share.getByLabel('Share with', { exact: true }).selectOption({ label: memberName });
  await share.getByLabel('Permission', { exact: true }).selectOption('write');
  await share.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(share.getByTestId(`member-${memberName}`)).toBeVisible();
  await page.keyboard.press('Escape');

  const viewer = member.page;
  await viewer.reload();
  await unlock(viewer, MEMBER_PASSPHRASE);
  const shared = viewer.getByRole('region', { name: 'Shared with you' });
  await expect(shared).toContainText(`Album from ${OWNER.username}`);
  await shared.getByRole('button', { name: /Road trip/ }).click();

  // Only the album: its two photos, no timeline and no other albums
  await expect(viewer).toHaveURL(/\/albums\/[0-9a-f-]{36}$/);
  await expect(viewer.getByRole('heading', { level: 1, name: 'Road trip' })).toBeVisible();
  await expectTilesDecrypted(viewer, 2);
  await expect(viewer.getByRole('navigation', { name: 'Main' }).first().getByRole('link', { name: 'Timeline' })).toHaveCount(0);
  await viewer.goto('/timeline');
  await unlock(viewer, MEMBER_PASSPHRASE);
  await viewer.getByRole('region', { name: 'Shared with you' }).getByRole('button', { name: /Road trip/ }).click();
  await expect(viewer).toHaveURL(/\/albums\/[0-9a-f-]{36}$/);

  // With write access they can add to the album, and the owner can read what they added
  await viewer.getByTestId('upload-input').setInputFiles(fixture('portrait.png'));
  await expect(viewer.getByTestId('upload-panel').getByRole('status')).toHaveText('1 uploaded', { timeout: 60_000 });
  await expectTilesDecrypted(viewer, 3);
  await page.reload();
  await unlock(page, OWNER.passphrase);
  await enterPassphrase(page, passphrase);
  await expectTilesDecrypted(page, 3);
  await openSection(page, 'Timeline');
  await expectTilesDecrypted(page, 6);

  // Restricting cuts the session and removes what was shared
  await openSection(page, 'Settings');
  await page.getByRole('button', { name: 'Manage users' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByTestId(`user-${memberName}`).getByRole('button', { name: 'Restrict' }).click();
  await expect(page.getByTestId(`user-${memberName}`)).toContainText('Restricted');

  await viewer.reload();
  await expect(viewer).toHaveURL(/\/login$/);
  await viewer.getByLabel('Username', { exact: true }).fill(memberName);
  await viewer.getByLabel('Password', { exact: true }).fill(MEMBER_PASSWORD);
  await viewer.getByRole('button', { name: 'Login' }).click();
  await expect(viewer.getByText('Account has been deactivated')).toBeVisible();
  await member.context.close();

  // Managing users did not close the owner's vault
  await page.getByRole('link', { name: 'Back' }).click();
  await expect(page).toHaveURL(/\/timeline$/);
  await openSection(page, 'Settings');
});

test('a reload keeps the sign-in but always asks for the passphrases', async () => {
  await page.reload();
  // Signed in (refresh cookie), keys gone
  await expect(page).toHaveURL(/\/unlock$/);
  await expect(page.getByRole('heading', { name: 'Unlock' })).toBeVisible();

  await unlock(page, OWNER.passphrase);
  await enterPassphrase(page, `${passphrase} wrong`);
  await expect(page.getByText('Invalid passphrase')).toBeVisible();
  await expect(page.getByLabel('Vault passphrase', { exact: true })).toHaveValue('');
  // The master passphrase is not a vault passphrase
  await enterPassphrase(page, OWNER.passphrase);
  await expect(page.getByText('Invalid passphrase')).toBeVisible();

  await enterPassphrase(page, passphrase);
  // Back to the screen that was open before the reload
  await expect(page).toHaveURL(/\/settings$/);
});

test('closing and locking remove decrypted media from the page', async () => {
  await openSection(page, 'Timeline');
  await expectTilesDecrypted(page, 6);
  // Thumbnails are in-memory object URLs, never data written to storage
  expect(await tiles(page).first().locator('img').getAttribute('src')).toMatch(/^blob:/);

  // Closing leaves the account unlocked but the vault needs its passphrase again
  await page.getByRole('button', { name: 'Close vault' }).click();
  await expect(page).toHaveURL(/\/unlock$/);
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.getByLabel('Master passphrase', { exact: true })).toHaveCount(0);
  await enterPassphrase(page, passphrase);
  await expectTilesDecrypted(page, 6);

  // Locking destroys every key: master passphrase first, then the vault's
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page).toHaveURL(/\/unlock$/);
  await expect(page.locator('img')).toHaveCount(0);
  await expect(page.getByLabel('Vault passphrase', { exact: true })).toHaveCount(0);

  await unlock(page, OWNER.passphrase);
  await enterPassphrase(page, passphrase);
  await expect(page).toHaveURL(/\/timeline$/);
  await expectTilesDecrypted(page, 6);
});

test('the same account can be signed in twice; logging out one keeps the other', async ({ browser }) => {
  const second = await newSession(browser);
  await login(second.page, OWNER.username, OWNER.password);
  await second.page.getByRole('button', { name: 'Logout' }).click();
  await expect(second.page).toHaveURL(/\/login$/);
  await second.context.close();

  await page.reload();
  await expect(page).toHaveURL(/\/unlock$/);
  await unlock(page, OWNER.passphrase);
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

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await enterPassphrase(page, passphrase);

  const picker = page.getByRole('dialog', { name: 'Select vault' });
  await expect(picker).toBeVisible();
  // The other browsers' vaults belong to this account too; only the two that matched are listed
  await expect(picker.getByRole('listitem')).toHaveCount(2);
  await picker.getByRole('button', { name: workLabel }).click();

  await expect(page.getByTestId('vault-label')).toHaveText(workLabel);
  await openSection(page, 'Timeline');
  await expect(page.getByRole('heading', { name: 'No photos yet' })).toBeVisible();

  // Dismissing the picker opens nothing
  await page.getByRole('button', { name: 'Close vault' }).click();
  await enterPassphrase(page, passphrase);
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(page).toHaveURL(/\/unlock$/);

  await enterPassphrase(page, passphrase);
  await picker.getByRole('button', { name: familyLabel }).click();
  await expect(page.getByTestId('vault-label')).toHaveText(familyLabel);
  await expectTilesDecrypted(page, 6);
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
  await expectTilesDecrypted(page, 6);

  // The viewer asks for its links at the moment of use, so it is unaffected
  await tiles(page).first().getByRole('button', { name: /^(Photo|Video)/ }).click();
  const image = page.getByTestId('viewer-image');
  await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('viewer')).toBeHidden();
});

test('theme choice applies and survives a reload', async () => {
  await openSection(page, 'Settings');
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await unlock(page, OWNER.passphrase);
  await enterPassphrase(page, passphrase);
  await picker(page, familyLabel);
  await page.getByRole('radio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('deleting a photo, a selection, an album, a user and a vault', async () => {
  await openSection(page, 'Timeline');
  await expectTilesDecrypted(page, 6);

  // One photo, from the viewer: it steps to the next one rather than closing
  await tiles(page).first().getByRole('button', { name: /^(Photo|Video)/ }).click();
  await page.getByTestId('viewer').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete this item?' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Deleted', { exact: true })).toBeVisible();
  await expect(page.getByTestId('viewer')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('viewer')).toBeHidden();
  await expectTilesDecrypted(page, 5);

  // A selection: cancelling keeps everything
  await tiles(page).nth(0).hover();
  await tiles(page).nth(0).getByRole('checkbox').click();
  await tiles(page).nth(1).getByRole('button', { name: /^(Photo|Video)/ }).click();
  const toolbar = page.getByRole('toolbar', { name: 'Selection' });
  await toolbar.getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog', { name: 'Delete 2 items?' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(tiles(page)).toHaveCount(5);
  await toolbar.getByRole('button', { name: 'Delete' }).click();
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('Deleted 2 items')).toBeVisible();
  await expect(toolbar).toBeHidden();
  await expectTilesDecrypted(page, 3);
  // Still gone after everything is fetched again
  await page.reload();
  await unlock(page, OWNER.passphrase);
  await enterPassphrase(page, passphrase);
  await picker(page, familyLabel);
  await expectTilesDecrypted(page, 3);

  // An album: its photos stay in the timeline
  await openSection(page, 'Albums');
  await page.getByRole('link', { name: /Road trip/ }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete Road trip?' }).getByRole('button', { name: 'Delete album' }).click();
  await expect(page.getByText('Deleted Road trip')).toBeVisible();
  await expect(page).toHaveURL(/\/albums$/);
  await expect(page.getByRole('link', { name: /Road trip/ })).toHaveCount(0);
  await openSection(page, 'Timeline');
  await expectTilesDecrypted(page, 3);

  // A user: the name has to be typed
  await openSection(page, 'Settings');
  await page.getByRole('button', { name: 'Manage users' }).click();
  await page.getByTestId(`user-${memberName}`).getByRole('button', { name: 'Delete' }).click();
  const deleteUser = page.getByRole('dialog', { name: `Delete ${memberName}?` });
  await expect(deleteUser.getByRole('button', { name: 'Delete user' })).toBeDisabled();
  await deleteUser.getByLabel(`Type ${memberName} to confirm`).fill(memberName);
  await deleteUser.getByRole('button', { name: 'Delete user' }).click();
  await expect(page.getByText(`${memberName} is deleted`)).toBeVisible();
  await expect(page.getByTestId(`user-${memberName}`)).toHaveCount(0);
  await expect(ApiUser.signIn({ username: memberName, password: MEMBER_PASSWORD, passphrase: MEMBER_PASSPHRASE })).rejects.toBeInstanceOf(ApiError);
  await page.getByRole('link', { name: 'Back' }).click();

  // The vault: only with its passphrase
  await openSection(page, 'Settings');
  await page.getByRole('button', { name: 'Delete vault' }).click();
  const deleteVault = page.getByRole('dialog', { name: `Delete ${familyLabel}?` });
  await expect(deleteVault).toContainText('3 items');
  await deleteVault.getByLabel('Vault passphrase', { exact: true }).fill(`${passphrase} wrong`);
  await deleteVault.getByRole('button', { name: 'Delete vault' }).click();
  await expect(deleteVault.getByRole('alert')).toHaveText('Wrong passphrase');
  await expect(page.getByTestId('vault-label')).toHaveText(familyLabel);
  await deleteVault.getByLabel('Vault passphrase', { exact: true }).fill(passphrase);
  await deleteVault.getByRole('button', { name: 'Delete vault' }).click();
  await expect(page.getByText(`Deleted ${familyLabel}`)).toBeVisible();
  await expect(page).toHaveURL(/\/unlock$/);

  // The passphrase that used to match two vaults now opens the one that is left
  await enterPassphrase(page, passphrase);
  await expect(page.getByTestId('vault-label')).toHaveText(workLabel);
  await openSection(page, 'Settings');
});

test('logout returns to sign-in and nothing broke along the way', async () => {
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page).toHaveURL(/\/login$/);
  // The username is remembered for next time; the password never is
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue(OWNER.username);
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
