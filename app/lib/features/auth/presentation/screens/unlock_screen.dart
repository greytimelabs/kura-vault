import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/vault/vault_cubit.dart';
import '../widgets/account_switcher_sheet.dart';

/// The master passphrase. It decrypts the account's private keys on this
/// device; the server takes no part and cannot tell whether it was right.
class UnlockScreen extends StatefulWidget {
  const UnlockScreen({super.key});

  @override
  State<UnlockScreen> createState() => _UnlockScreenState();
}

class _UnlockScreenState extends State<UnlockScreen> {
  final _controller = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _controller.clear();
    _controller.dispose();
    super.dispose();
  }

  Future<void> _unlock() async {
    final passphrase = _controller.text;
    if (passphrase.isEmpty) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    // Captured before any await: using context across an async gap is unsafe.
    final vaultCubit = context.read<VaultCubit>();
    final cryptoCubit = context.read<VaultCryptoCubit>();
    // Out of the field before the slow work starts
    _controller.clear();

    try {
      final account = await vaultCubit.fetchAccount();
      final ok = await cryptoCubit.unlockAccount(account: account, passphrase: passphrase);
      // On success the router moves on by itself
      if (!ok) _fail('Invalid passphrase');
    } on KeysNotYoursException catch (e) {
      _fail(e.toString());
    } catch (_) {
      _fail('Something went wrong');
    }
  }

  void _fail(String message) {
    if (!mounted) return;
    setState(() {
      _error = message;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final account = context.select((AuthCubit cubit) => cubit.state.active);

    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.lock_outline, size: 64, color: Colors.blueGrey),
              const SizedBox(height: 24),
              const Text(
                'Unlock',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              const Text('Your keys are decrypted only on this device'),
              if (account != null) ...[
                const SizedBox(height: 12),
                // Which account this passphrase is for, and the way to another
                ActionChip(
                  avatar: const Icon(Icons.swap_horiz, size: 18),
                  label: Text(
                    '${account.username} · ${account.host}',
                    overflow: TextOverflow.ellipsis,
                  ),
                  tooltip: 'Switch account',
                  onPressed: () => AccountSwitcherSheet.show(context),
                ),
              ],
              const SizedBox(height: 32),
              TextField(
                controller: _controller,
                obscureText: true,
                autofocus: true,
                enableSuggestions: false,
                autocorrect: false,
                decoration: InputDecoration(
                  hintText: 'Master passphrase',
                  errorText: _error,
                  errorMaxLines: 3,
                  border: const OutlineInputBorder(),
                  prefixIcon: const Icon(Icons.key),
                ),
                onSubmitted: (_) => _unlock(),
              ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: ElevatedButton(
                  onPressed: _loading ? null : _unlock,
                  child: _loading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Unlock'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
