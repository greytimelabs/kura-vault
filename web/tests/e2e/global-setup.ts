import { request } from '@playwright/test';
import { API_URL, OWNER } from './env';

/**
 * The first device ever registered becomes the owner. All three browser projects
 * share one backend, so that registration happens once, here, before any of them start.
 */
export default async function globalSetup(): Promise<void> {
  const api = await request.newContext();
  const response = await api.post(`${API_URL}/auth/register`, {
    data: { name: OWNER.name, deviceId: OWNER.deviceId, password: OWNER.password },
  });
  if (!response.ok()) {
    throw new Error(`Could not register the owner device: ${response.status()} ${await response.text()}`);
  }
  await api.dispose();
}
