import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/widgets/confirm_delete_dialog.dart';
import '../../data/users_api.dart';

/// Owner only. The owner decides who has an account, what kind, and can cut
/// one off. They cannot see anyone's photos, vaults or passphrases from here,
/// or at all.
class UsersScreen extends StatefulWidget {
  const UsersScreen({super.key});

  @override
  State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  late final UsersApi _api = UsersApi(context.read<ApiClient>());
  List<UserRow>? _users;
  List<PendingInvite> _invites = const [];
  String? _loadError;
  String? _busyId;

  @override
  void initState() {
    super.initState();
    _load(certify: true);
  }

  Future<void> _load({bool certify = false}) async {
    final crypto = context.read<VaultCryptoCubit>();
    try {
      var list = await _api.list();
      // Someone joined while this screen was not open: verify and sign their
      // keys now, so the owner never has to lock and unlock to make a new
      // user shareable
      if (certify && list.users.any((u) => u.verification != null)) {
        final rejected = await certifyPendingUsers(_api, crypto);
        if (rejected.isNotEmpty) _say(rejectedKeysMessage(rejected), error: true);
        list = await _api.list();
      }
      if (!mounted) return;
      setState(() {
        _users = list.users;
        _invites = list.invites;
        _loadError = null;
      });
    } catch (e) {
      if (mounted) {
        setState(() => _loadError = apiErrorMessage(e, 'Error loading users'));
      }
    }
  }

  void _say(String message, {bool error = false}) {
    if (!mounted) return;
    final scheme = Theme.of(context).colorScheme;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? scheme.error : null,
    ));
  }

  Future<void> _change(String id, Future<void> Function() work, String done) async {
    setState(() => _busyId = id);
    try {
      await work();
      _say(done);
    } catch (e) {
      _say(apiErrorMessage(e, 'Could not save the change'), error: true);
    } finally {
      if (mounted) setState(() => _busyId = null);
      await _load();
    }
  }

  Future<void> _restrict(UserRow user) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Restrict ${user.username}?'),
        content: const Text(
          'They are signed out everywhere at once and everything shared with '
          'them is removed. Lifting the restriction later lets them sign in '
          'again, but vaults and albums have to be shared with them again.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Restrict'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await _change(
      user.userId,
      () => _api.update(user.userId, status: 'restricted'),
      '${user.username} is restricted',
    );
  }

  Future<void> _delete(UserRow user) async {
    // What would go with the account; asked for only now
    ({int vaults, int items})? summary;
    setState(() => _busyId = user.userId);
    try {
      summary = await _api.deletionSummary(user.userId);
    } catch (_) {
      // The warning below covers it without the numbers
    } finally {
      if (mounted) setState(() => _busyId = null);
    }
    if (!mounted) return;

    final String vaults;
    if (summary == null) {
      vaults = 'Any vault this user created is erased with it, for everyone it is shared with.';
    } else if (summary.vaults == 0) {
      vaults = 'This user has created no vaults.';
    } else {
      vaults =
          '${summary.vaults == 1 ? '1 vault' : '${summary.vaults} vaults'} this user created, '
          'with ${summary.items == 1 ? '1 item' : '${summary.items} items'}, will be erased as well, '
          'for everyone they are shared with.';
    }

    final deleted = await ConfirmDeleteDialog.show(
      context,
      title: 'Delete ${user.username}?',
      body: [
        'The account is deleted and signed out everywhere, and everything shared with it is removed.',
        vaults,
        'This cannot be undone.',
      ],
      confirmLabel: 'Delete user',
      inputLabel: 'Type ${user.username} to confirm',
      expected: user.username,
      onConfirm: (_) => _api.deleteUser(user.userId),
    );
    if (!deleted) return;
    _say('${user.username} is deleted');
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final users = _users;
    return Scaffold(
      appBar: AppBar(title: const Text('Users')),
      body: _loadError != null
          ? Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(_loadError!),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: () {
                      setState(() => _loadError = null);
                      _load(certify: true);
                    },
                    child: const Text('Retry'),
                  ),
                ],
              ),
            )
          : users == null
              ? const Center(child: CircularProgressIndicator())
              : ListView(
                  children: [
                    for (final user in users) _userTile(user),
                    if (_invites.isNotEmpty) ...[
                      const Divider(),
                      Padding(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                        child: Text('INVITED',
                            style: Theme.of(context).textTheme.labelMedium),
                      ),
                      for (final invite in _invites) _inviteTile(invite),
                    ],
                    const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text(
                        'New users are invited from the web client: it makes '
                        'the invite link.',
                        textAlign: TextAlign.center,
                      ),
                    ),
                  ],
                ),
    );
  }

  Widget _userTile(UserRow user) {
    final scheme = Theme.of(context).colorScheme;
    final busy = _busyId == user.userId;
    return ListTile(
      key: ValueKey('user-${user.username}'),
      title: Wrap(
        spacing: 8,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: [
          Text(user.username),
          if (user.isOwner) const _Badge('Owner'),
          if (!user.isActive) _Badge('Restricted', color: scheme.error),
        ],
      ),
      subtitle: Row(
        children: [
          Icon(
            user.isVerified ? Icons.verified_user_outlined : Icons.gpp_maybe_outlined,
            size: 16,
            color: user.isVerified ? null : scheme.error,
          ),
          const SizedBox(width: 4),
          Expanded(
            child: Text(user.isVerified
                ? 'Keys verified'
                : 'Keys not verified: nothing can be shared with this account'),
          ),
        ],
      ),
      trailing: user.isOwner
          ? null
          : busy
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : PopupMenuButton<String>(
                  tooltip: 'Change ${user.username}',
                  enabled: _busyId == null,
                  onSelected: (action) => switch (action) {
                    'limited' || 'full' => _change(
                        user.userId,
                        () => _api.update(user.userId, accessLevel: action),
                        '${user.username} now has $action access',
                      ),
                    'restrict' => _restrict(user),
                    'delete' => _delete(user),
                    _ => _change(
                        user.userId,
                        () => _api.update(user.userId, status: 'active'),
                        '${user.username} can sign in again',
                      ),
                  },
                  itemBuilder: (_) => [
                    CheckedPopupMenuItem(
                      value: 'limited',
                      checked: user.accessLevel == 'limited',
                      child: const Text('Limited access'),
                    ),
                    CheckedPopupMenuItem(
                      value: 'full',
                      checked: user.accessLevel == 'full',
                      child: const Text('Full access'),
                    ),
                    const PopupMenuDivider(),
                    user.isActive
                        ? const PopupMenuItem(
                            value: 'restrict', child: Text('Restrict'))
                        : const PopupMenuItem(
                            value: 'lift', child: Text('Lift restriction')),
                    PopupMenuItem(
                      value: 'delete',
                      child: Text('Delete', style: TextStyle(color: scheme.error)),
                    ),
                  ],
                ),
    );
  }

  Widget _inviteTile(PendingInvite invite) {
    final busy = _busyId == invite.id;
    return ListTile(
      title: Text(invite.username),
      subtitle: Text(
        '${invite.accessLevel == 'full' ? 'Full' : 'Limited'} access · '
        '${invite.expired ? 'link expired' : 'has not joined yet'}',
      ),
      trailing: TextButton(
        onPressed: busy || _busyId != null
            ? null
            : () => _change(
                  invite.id,
                  () => _api.deleteInvite(invite.id),
                  'Invite cancelled',
                ),
        child: const Text('Cancel invite'),
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final String text;
  final Color? color;
  const _Badge(this.text, {this.color});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final tone = color ?? scheme.onSurfaceVariant;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: tone.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        text.toUpperCase(),
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: tone),
      ),
    );
  }
}
