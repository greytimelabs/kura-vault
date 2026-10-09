import { ApiUser } from './apiUser';
import { OWNER, SETUP_KEY } from './env';

/**
 * A new server has no accounts and accepts one thing: creating its owner with
 * the setup key. All three browser projects share one backend, so that happens
 * once, here, before any of them start, with the same key handling the page runs.
 */
export default async function globalSetup(): Promise<void> {
  await ApiUser.setup(SETUP_KEY, OWNER);
}
