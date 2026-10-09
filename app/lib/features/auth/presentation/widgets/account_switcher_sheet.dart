import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/auth/auth_state.dart';
import '../../../../core/accounts/account.dart';

/// Lists every account on this device: tap to switch, add another, or sign
/// out of / remove one.
///
/// Switching locks the open vault (the app shell does that when the active
/// account changes) and lands on the passphrase screen for the new account.
class AccountSwitcherSheet extends StatelessWidget {
  const AccountSwitcherSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => const AccountSwitcherSheet(),
    );
  }

  /// Where to send someone to sign in to [account] again: server and username
  /// are already known, so only the password is asked.
  static String loginLocation(Account account, {bool add = false}) {
    return Uri(path: '/login', queryParameters: {
      'server': account.serverUrl,
      'username': account.username,
      if (add) 'add': '1',
    }).toString();
  }

  void _select(BuildContext context, Account account, bool isActive) {
    final cubit = context.read<AuthCubit>();
    final router = GoRouter.of(context);
    Navigator.of(context).pop();
    if (isActive) return;
    if (account.signedIn) {
      cubit.switchAccount(account.id);
    } else {
      router.push(loginLocation(account, add: true));
    }
  }

  Future<void> _confirmRemove(BuildContext context, Account account) async {
    final cubit = context.read<AuthCubit>();
    final navigator = Navigator.of(context);
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Remove account?'),
        content: Text(
          '${account.username} on ${account.host} will be signed out and '
          'removed from this device. Nothing is deleted on the server.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Remove'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    // Close the sheet first: removing the last account leaves this screen.
    navigator.pop();
    await cubit.removeAccount(account.id);
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: BlocBuilder<AuthCubit, AuthState>(
        builder: (context, state) {
          return Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(24, 0, 24, 8),
                child: Text(
                  'Accounts',
                  style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                ),
              ),
              Flexible(
                child: ListView(
                  shrinkWrap: true,
                  children: [
                    for (final account in state.accounts)
                      _AccountTile(
                        account: account,
                        isActive: account.id == state.activeId,
                        onTap: () => _select(
                            context, account, account.id == state.activeId),
                        onSignOut: () {
                          final cubit = context.read<AuthCubit>();
                          Navigator.of(context).pop();
                          cubit.signOut(account.id);
                        },
                        onRemove: () => _confirmRemove(context, account),
                      ),
                  ],
                ),
              ),
              const Divider(height: 1),
              ListTile(
                leading: const Icon(Icons.add),
                title: const Text('Add account'),
                onTap: () {
                  final router = GoRouter.of(context);
                  Navigator.of(context).pop();
                  router.push('/server?add=1');
                },
              ),
            ],
          );
        },
      ),
    );
  }
}

enum _AccountAction { signOut, remove }

class _AccountTile extends StatelessWidget {
  final Account account;
  final bool isActive;
  final VoidCallback onTap;
  final VoidCallback onSignOut;
  final VoidCallback onRemove;

  const _AccountTile({
    required this.account,
    required this.isActive,
    required this.onTap,
    required this.onSignOut,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return ListTile(
      leading: CircleAvatar(
        child: Text(account.username.characters.first.toUpperCase()),
      ),
      title: Text(account.username, overflow: TextOverflow.ellipsis),
      subtitle: Text(
        account.signedIn
            ? account.host
            : '${account.host} · Sign in required',
        overflow: TextOverflow.ellipsis,
      ),
      selected: isActive,
      onTap: onTap,
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (isActive) Icon(Icons.check, color: scheme.primary),
          PopupMenuButton<_AccountAction>(
            tooltip: 'Account options',
            onSelected: (action) => switch (action) {
              _AccountAction.signOut => onSignOut(),
              _AccountAction.remove => onRemove(),
            },
            itemBuilder: (_) => [
              if (account.signedIn)
                const PopupMenuItem(
                  value: _AccountAction.signOut,
                  child: Text('Sign out'),
                ),
              const PopupMenuItem(
                value: _AccountAction.remove,
                child: Text('Remove from this device'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}
