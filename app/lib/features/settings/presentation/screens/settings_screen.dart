import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../core/storage/cache_service.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          ListTile(
            leading: const Icon(Icons.lock),
            title: const Text('Lock Vault'),
            subtitle: const Text('Wipe keys from memory'),
            onTap: () {
              context.read<VaultCryptoCubit>().lock();
              context.read<CacheService>().dispose();
              context.go('/passphrase');
            },
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
            leading: const Icon(Icons.logout, color: Colors.red),
            title: const Text('Logout', style: TextStyle(color: Colors.red)),
            subtitle: const Text('Sign out and clear all data'),
            onTap: () async {
              context.read<VaultCryptoCubit>().lock();
              context.read<CacheService>().dispose();
              await context.read<AuthCubit>().logout();
              if (context.mounted) {
                context.go('/register');
              }
            },
          ),
        ],
      ),
    );
  }
}
