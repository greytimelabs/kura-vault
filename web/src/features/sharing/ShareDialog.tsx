import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { ensureAlbumKey } from '@/lib/albums';
import { errorMessage } from '@/lib/api/client';
import { albumApi, userApi, vaultApi } from '@/lib/api/endpoints';
import type { SharePermission } from '@/lib/api/types';
import { cryptoCall } from '@/lib/crypto/cryptoClient';
import { certifyPendingUsers } from '@/lib/session';
import { useIsOwner } from '@/state/authStore';
import type { UserKeys } from '@/lib/crypto/identity';
import { toast } from '@/state/toastStore';

export type ShareTarget =
  | { kind: 'vault'; id: string; name: string }
  | { kind: 'album'; id: string; name: string; vaultId: string };

interface ShareDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  target: ShareTarget;
}

const PERMISSIONS: { value: SharePermission; label: string }[] = [
  { value: 'view', label: 'Can view' },
  { value: 'write', label: 'Can view and add' },
];

/**
 * Share a vault or one album. The key is unwrapped and sealed to the recipient's
 * public key inside the worker; the passphrase is never shared and the server
 * only relays ciphertext. Only people whose keys the owner certified are offered.
 */
export function ShareDialog({ open, onOpenChange, target }: ShareDialogProps) {
  const queryClient = useQueryClient();
  const isOwner = useIsOwner();
  const api = target.kind === 'vault' ? vaultApi.members : albumApi.members;
  const membersKey = ['members', target.kind, target.id] as const;

  const members = useQuery({ queryKey: membersKey, queryFn: () => api.list(target.id), enabled: open, staleTime: 0 });
  const people = useQuery({
    queryKey: ['directory'],
    enabled: open,
    staleTime: 0,
    // The server's list is a claim; keep only users whose certificate verifies here
    queryFn: async (): Promise<UserKeys[]> => {
      // Someone who joined since the owner unlocked becomes shareable here
      if (isOwner) await certifyPendingUsers().catch(() => undefined);
      const users = await userApi.directory();
      const verified = await Promise.all(users.map((user) => cryptoCall('verifyUser', { user })));
      return users.filter((_, i) => verified[i]);
    },
  });

  const [userId, setUserId] = useState('');
  const [permission, setPermission] = useState<SharePermission>('view');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const current = (members.data ?? []).filter((m) => m.role !== 'creator');
  const taken = new Set((members.data ?? []).map((m) => m.userId));
  const candidates = (people.data ?? []).filter((user) => !taken.has(user.userId));

  const run = async (id: string, work: () => Promise<unknown>, done: string) => {
    setBusy(id);
    setError(null);
    try {
      await work();
      toast(done);
    } catch (err) {
      setError(errorMessage(err, err instanceof Error ? err.message : 'Could not save the change'));
    } finally {
      setBusy(null);
      void queryClient.invalidateQueries({ queryKey: membersKey });
    }
  };

  const share = () => {
    const recipient = candidates.find((user) => user.userId === userId);
    if (!recipient) return;
    void run(
      'add',
      async () => {
        let grant;
        if (target.kind === 'vault') {
          grant = await cryptoCall('shareVault', { vaultId: target.id, recipient });
        } else {
          await ensureAlbumKey(target.id, target.vaultId);
          grant = await cryptoCall('shareAlbum', { albumId: target.id, recipient });
        }
        await api.add(target.id, recipient.userId, permission, grant);
        setUserId('');
      },
      `Shared ${target.name} with ${recipient.username}`,
    );
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`Share ${target.name}`}
      description={
        target.kind === 'vault'
          ? 'Everything in this vault, including every album.'
          : 'Only this album. The rest of the vault stays private.'
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="mb-1.5 block text-sm font-medium text-ink">Share with</span>
            <Select
              aria-label="Share with"
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              disabled={people.isPending || candidates.length === 0}
              className="w-full"
            >
              <option value="">{candidates.length === 0 && !people.isPending ? 'Nobody to share with' : 'Choose a user'}</option>
              {candidates.map((user) => (
                <option key={user.userId} value={user.userId}>
                  {user.username}
                </option>
              ))}
            </Select>
          </label>
          <Select
            aria-label="Permission"
            value={permission}
            onChange={(event) => setPermission(event.target.value as SharePermission)}
            className="shrink-0"
          >
            {PERMISSIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Button variant="primary" disabled={!userId} loading={busy === 'add'} onClick={share}>
            Share
          </Button>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <section>
          <h3 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-muted">People with access</h3>
          {members.isPending ? (
            <div className="flex justify-center py-4 text-muted">
              <Spinner label="Loading" />
            </div>
          ) : current.length === 0 ? (
            <p className="py-2 text-sm text-muted">Only you.</p>
          ) : (
            <ul className="divide-y divide-line">
              {current.map((member) => (
                <li key={member.userId} className="flex items-center gap-2 py-2" data-testid={`member-${member.username}`}>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{member.username}</span>
                  <Select
                    aria-label={`Permission for ${member.username}`}
                    value={member.permission}
                    disabled={busy !== null}
                    onChange={(event) =>
                      void run(
                        member.userId,
                        () => api.update(target.id, member.userId, event.target.value as SharePermission),
                        `Updated ${member.username}`,
                      )
                    }
                    size="sm"
                    className="shrink-0"
                  >
                    {PERMISSIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === member.userId}
                    onClick={() =>
                      void run(
                        member.userId,
                        () => api.remove(target.id, member.userId),
                        `${member.username} no longer has access`,
                      )
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[13px] leading-relaxed text-muted">
          Removing someone stops their access immediately. It cannot take back photos they already downloaded.
        </p>
      </div>
    </Modal>
  );
}
