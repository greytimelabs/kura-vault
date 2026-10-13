import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/media/media_cubit.dart';
import '../../../../blocs/vault/vault_cubit.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';
import '../../../../core/widgets/confirm_delete_dialog.dart';
import 'package:go_router/go_router.dart';
import '../../../../core/storage/cache_service.dart';
import '../../../../core/storage/preferences.dart';
import '../../../auth/presentation/widgets/account_switcher_sheet.dart';
import '../../../auth/presentation/widgets/create_vault_dialog.dart';
import '../../../sharing/presentation/widgets/share_sheet.dart';
import '../widgets/biometric_setting_tile.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  /// Another vault is open: drop the new one's key rather than switching
  /// silently.
  Future<void> _createVault(BuildContext context) async {
    final crypto = context.read<VaultCryptoCubit>();
    final messenger = ScaffoldMessenger.of(context);
    final created = await CreateVaultDialog.show(context);
    if (created == null) return;
    final label = created.label;
    crypto.discardMatches([created]);
    messenger.showSnackBar(SnackBar(
      content: Text(
          'Created $label. Close this vault and enter its passphrase to open it.'),
    ));
  }

  /// Erase the open vault. Its passphrase is checked on this device first, so
  /// an unlocked phone left on a table is not enough to destroy a vault.
  Future<void> _deleteVault(BuildContext context, String vaultId, String label) async {
    final crypto = context.read<VaultCryptoCubit>();
    final vaults = context.read<VaultCubit>();
    final media = context.read<MediaCubit>();
    final cache = context.read<CacheService>();
    final api = context.read<ApiClient>();
    final messenger = ScaffoldMessenger.of(context);

    int? items;
    try {
      final response = await api.dio.get(
        ApiEndpoints.media,
        queryParameters: {'vaultId': vaultId, 'page': 1, 'limit': 1},
      );
      items = (response.data['data'] as Map<String, dynamic>)['total'] as int;
    } catch (_) {
      // The warning below covers it without the number
    }
    if (!context.mounted) return;

    final String what;
    if (items == null) {
      what = 'Everything in this vault is';
    } else if (items == 1) {
      what = '1 item and every album in this vault is';
    } else {
      what = '$items items and every album in this vault are';
    }

    final deleted = await ConfirmDeleteDialog.show(
      context,
      title: 'Delete $label?',
      body: [
        '$what erased, for you and for everyone the vault is shared with. This cannot be undone.',
        "Enter this vault's passphrase to confirm.",
      ],
      confirmLabel: 'Delete vault',
      inputLabel: 'Vault passphrase',
      secret: true,
      onConfirm: (passphrase) async {
        final own = (await vaults.fetchVaults()).where((v) => v.id == vaultId).toList();
        final matches = await crypto.findMatches(passphrase: passphrase, vaults: own);
        final right = matches.any((m) => m.vaultId == vaultId);
        crypto.discardMatches(matches);
        if (!right) throw StateError('Wrong passphrase');
        await vaults.deleteVault(vaultId);
      },
    );
    if (!deleted) return;
    messenger.showSnackBar(SnackBar(content: Text('Deleted $label')));
    await cache.clearCache();
    media.reset();
    // The router returns to the list once nothing is open
    crypto.closeVault();
  }

  @override
  Widget build(BuildContext context) {
    final account = context.select((AuthCubit cubit) => cubit.state.active);
    final albumOnly = context.select<VaultCryptoCubit, bool>(
        (VaultCryptoCubit cubit) => cubit.state.albumOnlyId != null);
    final crypto = context.select((VaultCryptoCubit cubit) => cubit.state);
    final vaultId = crypto.activeVaultId;
    final preferences = context.watch<Preferences>().state;

    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: [
          if (crypto.isCreator && vaultId != null)
            ListTile(
              leading: const Icon(Icons.share_outlined),
              title: const Text('Share this vault'),
              subtitle: Text(
                  'Choose who else can open ${crypto.activeLabel ?? 'this vault'}, '
                  'and whether they can add photos'),
              onTap: () => ShareSheet.showForVault(
                context,
                vaultId: vaultId,
                name: crypto.activeLabel ?? 'this vault',
              ),
            ),
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
            leading: const Icon(Icons.key_outlined),
            title: const Text('Lock automatically'),
            subtitle: const Text(
                'Every key is wiped after this long without activity, in the app or away from it'),
            trailing: DropdownButton<int>(
              value: preferences.autoLockMinutes,
              underline: const SizedBox.shrink(),
              items: [
                for (final minutes in Preferences.autoLockOptions)
                  DropdownMenuItem(
                    value: minutes,
                    child: Text(minutes == 1 ? '1 minute' : '$minutes minutes'),
                  ),
              ],
              onChanged: (minutes) {
                if (minutes != null) {
                  context.read<Preferences>().setAutoLockMinutes(minutes);
                }
              },
            ),
          ),
          const BiometricSettingTile(),
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
          if (crypto.isCreator && vaultId != null)
            ListTile(
              leading: const Icon(Icons.delete_forever_outlined, color: Colors.red),
              title: const Text('Delete this vault', style: TextStyle(color: Colors.red)),
              subtitle: Text(
                  'Erase ${crypto.activeLabel ?? 'this vault'} and everything in it, '
                  'for everyone it is shared with'),
              onTap: () =>
                  _deleteVault(context, vaultId, crypto.activeLabel ?? 'this vault'),
            ),
          if (account != null && (account.isOwner || account.canCreateVaults)) ...[
            const Divider(),
            if (account.isOwner)
              ListTile(
                leading: const Icon(Icons.group_outlined),
                title: const Text('Users'),
                subtitle: const Text(
                    'Change what people may do, or restrict an account'),
                onTap: () => context.push('/users'),
              ),
            if (account.canCreateVaults)
              ListTile(
                leading: const Icon(Icons.key_outlined),
                title: const Text('Create a vault'),
                subtitle:
                    const Text('A separate set of photos with its own passphrase'),
                onTap: () => _createVault(context),
              ),
          ],
          const Divider(),
          ListTile(
            leading: const Icon(Icons.brightness_6_outlined),
            title: const Text('Theme'),
            subtitle: Padding(
              padding: const EdgeInsets.only(top: 8),
              child: SegmentedButton<ThemeMode>(
                showSelectedIcon: false,
                segments: const [
                  ButtonSegment(value: ThemeMode.system, label: Text('System')),
                  ButtonSegment(value: ThemeMode.light, label: Text('Light')),
                  ButtonSegment(value: ThemeMode.dark, label: Text('Dark')),
                ],
                selected: {preferences.theme},
                onSelectionChanged: (choice) =>
                    context.read<Preferences>().setTheme(choice.first),
              ),
            ),
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
