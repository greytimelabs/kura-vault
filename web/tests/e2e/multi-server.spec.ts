// The multi-server build: a client served apart from the API, where the user types
// a server address and can hold several accounts. The one test backend plays two
// servers by being reached under two host names.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { API_PORT, MULTI_WEB_URL, OWNER } from './env';

const SERVER_A = `http://localhost:${API_PORT}`;
const SERVER_B = `http://127.0.0.1:${API_PORT}`;
const HOST_A = `localhost:${API_PORT}`;
const HOST_B = `127.0.0.1:${API_PORT}`;

test.describe.configure({ mode: 'serial' });

let context: BrowserContext;
let page: Page;
const problems: string[] = [];

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) problems.push(`csp: ${message.text()}`);
  });
});

test.afterAll(async () => {
  await context?.close();
});

async function connect(address: string): Promise<void> {
  await page.getByLabel('Server URL', { exact: true }).fill(address);
  await page.getByRole('button', { name: 'Connect' }).click();
}

async function signIn(): Promise<void> {
  await page.getByLabel('Username', { exact: true }).fill(OWNER.username);
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/unlock$/);
}

const openAccounts = () => page.getByRole('button', { name: 'Accounts' }).click();
const accountItem = (host: string) => page.getByRole('menuitem').filter({ hasText: host });

test('a first visit asks for the server and refuses bad addresses', async () => {
  await page.goto(`${MULTI_WEB_URL}/`);
  await expect(page).toHaveURL(/\/server$/);

  await connect('http://example.com');
  await expect(page.getByText('The server must use https://')).toBeVisible();

  // Something answers there, but it is not a Kura Vault server
  await connect(`${SERVER_A}/not-a-vault`);
  await expect(page.getByText('This does not look like a Kura Vault server')).toBeVisible();
});

test('signs in to a typed server', async () => {
  await connect(`${SERVER_A}/api/v1/`);
  await expect(page).toHaveURL(/\/login\?server=/);
  await expect(page.getByTestId('login-server')).toHaveText(HOST_A);
  await signIn();
});

test('adds a second account and switches both ways without a password', async () => {
  await openAccounts();
  await page.getByRole('menuitem', { name: 'Add account' }).click();
  await expect(page).toHaveURL(/\/server\?add=1$/);
  await connect(SERVER_B);
  await expect(page.getByTestId('login-server')).toHaveText(HOST_B);
  await signIn();

  await openAccounts();
  await expect(page.getByRole('menuitem').filter({ hasText: OWNER.username })).toHaveCount(2);
  await expect(accountItem(HOST_B).getByLabel('Active')).toBeVisible();

  await accountItem(HOST_A).click();
  await expect(page).toHaveURL(/\/unlock$/);
  await expect(page.getByLabel('Master passphrase', { exact: true })).toBeVisible();
  await openAccounts();
  await expect(accountItem(HOST_A).getByLabel('Active')).toBeVisible();

  await accountItem(HOST_B).click();
  await expect(page.getByLabel('Master passphrase', { exact: true })).toBeVisible();
  await openAccounts();
  await expect(accountItem(HOST_B).getByLabel('Active')).toBeVisible();
  await page.keyboard.press('Escape');
});

test('both accounts survive a reload and no password is stored', async () => {
  await page.reload();
  await expect(page).toHaveURL(/\/unlock$/);
  await expect(page.getByLabel('Master passphrase', { exact: true })).toBeVisible();

  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).toContain(HOST_A);
  expect(stored).toContain(HOST_B);
  expect(stored).not.toContain(OWNER.password);
});

test('signing out keeps the entry and moves to the account still signed in', async () => {
  await openAccounts();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  // B is signed out; A takes over without asking for anything but its passphrase
  await expect(page.getByLabel('Master passphrase', { exact: true })).toBeVisible();
  await openAccounts();
  await expect(accountItem(HOST_A).getByLabel('Active')).toBeVisible();
  await expect(accountItem(HOST_B)).toContainText('Sign in required');

  await page.getByRole('menuitem', { name: 'Sign out' }).click();

  // Nobody is signed in: the sign-in page for the last account, username remembered
  await expect(page).toHaveURL(/\/login\?server=/);
  await expect(page.getByTestId('login-server')).toHaveText(HOST_A);
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue(OWNER.username);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('');
});

test('a saved account signs back in with only the password', async () => {
  await page.getByLabel('Password', { exact: true }).fill(OWNER.password);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page).toHaveURL(/\/unlock$/);

  await openAccounts();
  await expect(page.getByRole('menuitem').filter({ hasText: OWNER.username })).toHaveCount(2);
  await page.keyboard.press('Escape');
});

test('nothing was blocked or thrown', () => {
  expect(problems).toEqual([]);
});
