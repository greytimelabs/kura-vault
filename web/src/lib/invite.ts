// The invite link. Everything that matters is in the fragment, which browsers
// never send to any server: the secret that proves the invitee's keys to the
// owner, and the owner's signing key that the invitee will trust from then on.
import { b64decode, b64encode, utf8Decode, utf8Encode } from './crypto/base64';

export interface InviteLink {
  /** The API server, for clients not served by it (the multi-server web build and the mobile app). */
  server: string | null;
  inviteId: string;
  /** base64. Never sent to the server. */
  secret: string;
  /** base64 Ed25519 public key of the server owner. */
  ownerSignKey: string;
}

const VERSION = 'v1';
export const INVITE_PATH = '/join';

const toUrlSafe = (b64: string) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromUrlSafe = (value: string) =>
  value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');

export function encodeInviteLink(origin: string, invite: InviteLink): string {
  const payload = JSON.stringify({ s: invite.server, i: invite.inviteId, k: invite.secret, o: invite.ownerSignKey });
  return `${origin}${INVITE_PATH}#${VERSION}.${toUrlSafe(b64encode(utf8Encode(payload)))}`;
}

/** Accepts a whole link or just what follows the `#`. Throws an Error whose message can be shown. */
export function decodeInviteLink(link: string): InviteLink {
  const fragment = link.includes('#') ? link.slice(link.indexOf('#') + 1) : link.trim();
  const [version, encoded] = fragment.split('.');
  try {
    if (version !== VERSION || !encoded) throw new Error();
    const payload = JSON.parse(utf8Decode(b64decode(fromUrlSafe(encoded)))) as Record<string, unknown>;
    const invite: InviteLink = {
      server: typeof payload.s === 'string' ? payload.s : null,
      inviteId: String(payload.i),
      secret: String(payload.k),
      ownerSignKey: String(payload.o),
    };
    if (b64decode(invite.secret).length !== 32 || b64decode(invite.ownerSignKey).length !== 32) throw new Error();
    if (!/^[0-9a-f-]{36}$/.test(invite.inviteId)) throw new Error();
    return invite;
  } catch {
    throw new Error('This invite link is not valid. Ask the owner for a new one.');
  }
}
