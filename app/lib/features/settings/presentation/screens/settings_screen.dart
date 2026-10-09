import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../core/storage/cache_service.dart';
import '../../../auth/presentation/widgets/account_switcher_sheet.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final account = context.select((AuthCubit cubit) => cubit.state.active);
    final albumOnly = context.select<VaultCryptoCubit, bool>(
        (VaultCryptoCubit cubit) => cubit.state.albumOnlyId != null);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.logout),
            title: Text(albumOnly ? 'Close album' : 'Close vault'),
            subtitle: const Text('Go back to what you can open. You stay unlocked'),
            // The router returns to the list once nothing is open
            onTap: () => context.read<VaultCryptoCubit>().closeVault(),
          ),
          ListTile(
            leading: const Icon(Icons.lock),
            title: const Text('Lock'),
            subtitle: const Text(
                'Wipe every key from memory. The master passphrase is needed again'),
            onTap: () => context.read<VaultCryptoCubit>().lock(),
          ),
          ListTile(
            leading: const Icon(Icons.delete_sweep),
            title: const Text('Clear Cache'),
            subtitle: const Text('Remove cached thumbnails'),
            onTap: () async {
              await context.read<CacheService>().clearCache();
              if (context.mounted) {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Cache cleared')),
                );
              }
            },
          ),
          const Divider(),
          ListTile(
            leading: const Icon(Icons.switch_account_outlined),
            title: const Text('Accounts'),
            subtitle: Text(account == null
                ? 'Switch or add an account'
                : '${account.username} · ${account.host}'),
            onTap: () => AccountSwitcherSheet.show(context),
          ),
          ListTile(
            leading: const Icon(Icons.logout, color: Colors.red),
            title: const Text('Sign out', style: TextStyle(color: Colors.red)),
            subtitle: const Text(
                'Sign out of this account. Its server and username stay saved'),
            // Everything is locked and the screen changes when the active
            // account loses its login (see KuraVaultApp).
            onTap: account == null
                ? null
                : () => context.read<AuthCubit>().signOut(account.id),
          ),
        ],
      ),
    );
  }
}
