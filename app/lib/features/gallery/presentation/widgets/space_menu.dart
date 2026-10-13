import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';

/// Leaving what is open: close it, lock everything, or go to Settings.
class SpaceMenu extends StatelessWidget {
  const SpaceMenu({super.key});

  @override
  Widget build(BuildContext context) {
    final albumOnly =
        context.select((VaultCryptoCubit c) => c.state.albumOnlyId != null);
    return PopupMenuButton<String>(
      tooltip: 'More',
      onSelected: (action) {
        final crypto = context.read<VaultCryptoCubit>();
        switch (action) {
          case 'close':
            // Back to the list of what can be opened; the account stays unlocked
            crypto.closeVault();
          case 'lock':
            // Wipes every key: the master passphrase is needed again
            crypto.lock();
          default:
            context.push('/settings');
        }
      },
      itemBuilder: (_) => [
        PopupMenuItem(
          value: 'close',
          child: ListTile(
            leading: const Icon(Icons.logout),
            title: Text(albumOnly ? 'Close album' : 'Close vault'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        const PopupMenuItem(
          value: 'lock',
          child: ListTile(
            leading: Icon(Icons.lock),
            title: Text('Lock'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
        const PopupMenuDivider(),
        const PopupMenuItem(
          value: 'settings',
          child: ListTile(
            leading: Icon(Icons.settings),
            title: Text('Settings'),
            contentPadding: EdgeInsets.zero,
          ),
        ),
      ],
    );
  }
}
