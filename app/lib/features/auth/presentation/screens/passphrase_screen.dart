import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';

import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/vault/vault_cubit.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../core/network/api_client.dart';
import '../../../users/data/users_api.dart';
import '../widgets/account_switcher_sheet.dart';
import '../../../../core/widgets/kura_mark.dart';
import '../widgets/create_vault_dialog.dart';
import '../widgets/vault_picker_sheet.dart';

/// Shown once the account is unlocked: what others shared with it, listed, and
/// a passphrase field for the vaults it created, which are never listed.
/// Typing a vault passphrase opens the vault it belongs to and says nothing
/// about the rest.
class PassphraseScreen extends StatefulWidget {
  const PassphraseScreen({super.key});

  @override
  State<PassphraseScreen> createState() => _PassphraseScreenState();
}

class _PassphraseScreenState extends State<PassphraseScreen> {
  final _controller = TextEditingController();
  bool _loading = false;
  String? _error;
  List<SharedSpace> _shared = const [];
  bool _sharedLoaded = false;

  @override
  void initState() {
    super.initState();
    _loadShared();
    _certifyNewUsers();
  }

  /// The owner's client is what makes a new user shareable: it checks the keys
  /// they joined with against their invite and signs them. Done as soon as the
  /// owner's keys are loaded, so nobody waits for the owner to open a screen.
  Future<void> _certifyNewUsers() async {
    if (!(context.read<AuthCubit>().state.active?.isOwner ?? false)) return;
    final api = UsersApi(context.read<ApiClient>());
    final crypto = context.read<VaultCryptoCubit>();
    try {
      final rejected = await certifyPendingUsers(api, crypto);
      if (rejected.isNotEmpty && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(rejectedKeysMessage(rejected)),
          backgroundColor: Theme.of(context).colorScheme.error,
        ));
      }
    } catch (_) {
      // Tried again when the users screen or a share sheet opens
    }
  }

  /// Make a vault and go straight into it.
  Future<void> _createVault() async {
    final cryptoCubit = context.read<VaultCryptoCubit>();
    final created = await CreateVaultDialog.show(context);
    // The router moves on to the gallery once a vault is open
    if (created != null) cryptoCubit.selectVault(created, [created]);
  }

  @override
  void dispose() {
    _controller.clear();
    _controller.dispose();
    super.dispose();
  }

  /// Open everything shared with this account. Shares that do not verify
  /// (a key the server made up, say) are left out by the keyring.
  Future<void> _loadShared() async {
    final vaultCubit = context.read<VaultCubit>();
    final cryptoCubit = context.read<VaultCryptoCubit>();
    try {
      final vaults = await vaultCubit.fetchVaults();
      final albums = await vaultCubit.fetchSharedAlbums();
      final spaces = await cryptoCubit.openShared(vaults: vaults, albums: albums);
      if (mounted) setState(() => _shared = spaces);
    } catch (_) {
      // The list stays empty; own vaults can still be opened
    } finally {
      if (mounted) setState(() => _sharedLoaded = true);
    }
  }

  Future<void> _open() async {
    final passphrase = _controller.text;
    if (passphrase.isEmpty) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    // Captured before any await: using context across an async gap is unsafe.
    final vaultCubit = context.read<VaultCubit>();
    final cryptoCubit = context.read<VaultCryptoCubit>();

    try {
      final vaults = await vaultCubit.fetchVaults();
      final matches = await cryptoCubit.findMatches(
        passphrase: passphrase,
        vaults: vaults,
      );

      _controller.clear();

      if (matches.isEmpty) {
        _fail();
        return;
      }

      MatchedVault chosen;
      if (matches.length == 1) {
        // Single match is the normal case and must look exactly as it always
        // has — no picker, no flash, no hint that a multi-match path exists.
        chosen = matches.first;
      } else {
        // The same passphrase was set on more than one vault. Each has its
        // own salt, so every one of these opened independently. Let the user
        // say which to open.
        if (!mounted) {
          cryptoCubit.discardMatches(matches);
          return;
        }
        final picked = await VaultPickerSheet.show(context, matches);
        if (picked == null) {
          // Dismissed — never strand live keys in memory.
          cryptoCubit.discardMatches(matches);
          if (mounted) setState(() => _loading = false);
          return;
        }
        chosen = picked;
      }

      // The router moves on to the gallery once a vault is open
      cryptoCubit.selectVault(chosen, matches);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = 'Something went wrong';
          _loading = false;
        });
      }
    }
  }

  void _fail() {
    if (!mounted) return;
    setState(() {
      // Wording unchanged: never distinguish "no vaults" from "wrong passphrase".
      _error = 'Invalid passphrase';
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final account = context.select((AuthCubit cubit) => cubit.state.active);
    // Limited users cannot create vaults, so they have none to open by passphrase
    final canHaveVaults = account?.canCreateVaults ?? false;

    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(32),
          children: [
            const SizedBox(height: 24),
            const KuraBadge(size: 64),
            const SizedBox(height: 24),
            const Text(
              'Open a vault',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
            ),
            if (account != null) ...[
              const SizedBox(height: 12),
              Center(
                child: ActionChip(
                  avatar: const Icon(Icons.swap_horiz, size: 18),
                  label: Text(
                    '${account.username} · ${account.host}',
                    overflow: TextOverflow.ellipsis,
                  ),
                  tooltip: 'Switch account',
                  onPressed: () => AccountSwitcherSheet.show(context),
                ),
              ),
            ],
            const SizedBox(height: 24),
            if (_shared.isNotEmpty) ...[
              Text('SHARED WITH YOU', style: Theme.of(context).textTheme.labelMedium),
              for (final space in _shared)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(space.isAlbum ? Icons.photo_album_outlined : Icons.folder_outlined),
                  title: Text(space.label, overflow: TextOverflow.ellipsis),
                  subtitle: Text(
                    '${space.isAlbum ? 'Album' : 'Vault'} from ${space.sharedBy} · '
                    '${space.canWrite ? 'can add photos' : 'view only'}',
                  ),
                  onTap: () => context.read<VaultCryptoCubit>().openSpace(space),
                ),
              const SizedBox(height: 16),
            ],
            if (canHaveVaults) ...[
              TextField(
                controller: _controller,
                obscureText: true,
                enableSuggestions: false,
                autocorrect: false,
                decoration: InputDecoration(
                  hintText: 'Vault passphrase',
                  helperText: 'Opens a vault you created.',
                  errorText: _error,
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.key),
                ),
                onSubmitted: (_) => _open(),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: _loading ? null : _open,
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Open'),
                ),
              ),
            ] else if (_sharedLoaded && _shared.isEmpty)
              const Text(
                'Nothing has been shared with you yet. Ask the owner to share a vault or an album.',
                textAlign: TextAlign.center,
              ),
            const SizedBox(height: 16),
            Wrap(
              alignment: WrapAlignment.center,
              spacing: 8,
              children: [
                if (canHaveVaults)
                  TextButton.icon(
                    onPressed: _loading ? null : _createVault,
                    icon: const Icon(Icons.add),
                    label: const Text('Create a vault'),
                  ),
                if (account?.isOwner ?? false)
                  TextButton.icon(
                    onPressed: () => context.push('/users'),
                    icon: const Icon(Icons.group_outlined),
                    label: const Text('Manage users'),
                  ),
                TextButton.icon(
                  // Wipes every key: the master passphrase is needed again
                  onPressed: () => context.read<VaultCryptoCubit>().lock(),
                  icon: const Icon(Icons.lock_outline),
                  label: const Text('Lock'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
