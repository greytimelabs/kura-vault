import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ShieldAlert, ShieldCheck, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { InviteUserDialog } from './InviteUserDialog';
import { Button } from '@/components/ui/Button';
import { ErrorState, FullPageSpinner } from '@/components/ui/StateMessage';
import { errorMessage } from '@/lib/api/client';
import { userApi } from '@/lib/api/endpoints';
import type { AccessLevel, UserRow } from '@/lib/api/types';
import { certifyPendingUsers } from '@/lib/session';
import { toast } from '@/state/toastStore';

const usersKey = ['users'] as const;

/**
 * Owner only. The owner decides who has an account, what kind, and can cut one
 * off. They cannot see anyone's photos, vaults or passphrases from here, or at all.
 */
export function UsersPage() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: usersKey, queryFn: userApi.list, staleTime: 0 });
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: usersKey });

  // Someone joined while this screen was not open: verify and sign their keys now,
  // so the owner never has to lock and unlock to make a new user shareable
  const awaitingVerification = list.data?.users.some((user) => user.verification) ?? false;
  useEffect(() => {
    if (awaitingVerification) void certifyPendingUsers().catch(() => undefined);
  }, [awaitingVerification]);

  const change = async (id: string, work: () => Promise<unknown>, done: string) => {
    setBusyId(id);
    try {
      await work();
      toast(done);
    } catch (err) {
      toast(errorMessage(err, 'Could not save the change'), 'error');
    } finally {
      setBusyId(null);
      void refresh();
    }
  };

  const restrict = (user: UserRow) => {
    const ok = window.confirm(
      `Restrict ${user.username}?\n\nThey are signed out everywhere at once and everything shared with them is removed. ` +
        'Lifting the restriction later lets them sign in again, but vaults and albums have to be shared with them again.',
    );
    if (ok) void change(user.userId, () => userApi.update(user.userId, { status: 'restricted' }), `${user.username} is restricted`);
  };

  return (
    <main className="min-h-dvh bg-bg px-4 py-8 text-ink">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center gap-3">
          <Link
            to="/unlock"
            aria-label="Back"
            className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-full text-ink hover:bg-accent-soft"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold tracking-tight">Users</h1>
          <Button variant="primary" icon={<UserPlus className="size-4" />} onClick={() => setInviting(true)}>
            Add user
          </Button>
        </header>

        {list.isPending ? (
          <div className="h-64">
            <FullPageSpinner />
          </div>
        ) : list.error ? (
          <ErrorState message={errorMessage(list.error, 'Error loading users')} onRetry={() => void list.refetch()} />
        ) : (
          <>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {list.data.users.map((user) => (
                <li key={user.userId} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5" data-testid={`user-${user.username}`}>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-[15px] font-medium">
                      <span className="truncate">{user.username}</span>
                      {user.role === 'owner' && <Badge>Owner</Badge>}
                      {user.status === 'restricted' && <Badge tone="danger">Restricted</Badge>}
                    </p>
                    <p className="flex items-center gap-1 text-[13px] text-muted">
                      {user.keyCert ? (
                        <>
                          <ShieldCheck className="size-3.5" aria-hidden /> Keys verified
                        </>
                      ) : (
                        <>
                          <ShieldAlert className="size-3.5 text-danger" aria-hidden /> Keys not verified: nothing can be
                          shared with this account
                        </>
                      )}
                    </p>
                  </div>
                  {user.role !== 'owner' && (
                    <div className="flex shrink-0 items-center gap-2">
                      <select
                        aria-label={`Access for ${user.username}`}
                        value={user.accessLevel}
                        disabled={busyId === user.userId}
                        onChange={(event) =>
                          void change(
                            user.userId,
                            () => userApi.update(user.userId, { accessLevel: event.target.value as AccessLevel }),
                            `${user.username} now has ${event.target.value} access`,
                          )
                        }
                        className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
                      >
                        <option value="limited">Limited</option>
                        <option value="full">Full</option>
                      </select>
                      {user.status === 'active' ? (
                        <Button size="sm" variant="danger" loading={busyId === user.userId} onClick={() => restrict(user)}>
                          Restrict
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          loading={busyId === user.userId}
                          onClick={() =>
                            void change(
                              user.userId,
                              () => userApi.update(user.userId, { status: 'active' }),
                              `${user.username} can sign in again`,
                            )
                          }
                        >
                          Lift restriction
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {list.data.invites.length > 0 && (
              <section className="mt-7">
                <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Invited</h2>
                <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                  {list.data.invites.map((invite) => (
                    <li key={invite.id} className="flex items-center gap-4 px-4 py-3.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[15px] font-medium">{invite.username}</p>
                        <p className="text-[13px] text-muted">
                          {invite.accessLevel === 'full' ? 'Full' : 'Limited'} access ·{' '}
                          {invite.expired ? 'link expired' : 'has not joined yet'}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="danger"
                        loading={busyId === invite.id}
                        onClick={() => void change(invite.id, () => userApi.deleteInvite(invite.id), 'Invite cancelled')}
                      >
                        Cancel invite
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      <InviteUserDialog open={inviting} onOpenChange={setInviting} />
    </main>
  );
}

function Badge({ children, tone = 'neutral' }: { children: string; tone?: 'neutral' | 'danger' }) {
  return (
    <span
      className={
        tone === 'danger'
          ? 'rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-danger'
          : 'rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted'
      }
    >
      {children}
    </span>
  );
}
