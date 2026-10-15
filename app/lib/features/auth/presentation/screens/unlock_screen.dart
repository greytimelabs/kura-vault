import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/vault/vault_cubit.dart';
import '../../../../core/crypto/crypto_service.dart';
import '../../../../core/platform/biometric_channel.dart';
import '../../../../core/security/biometric_unlock.dart';
import '../../../../core/widgets/kura_mark.dart';
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

  /// What fingerprint or face unlock can do for the account on screen.
  BiometricOffer _offer = BiometricOffer.off;
  String? _offerFor;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback(
      (_) => _checkBiometrics(prompt: true),
    );
  }

  /// Find out whether a fingerprint or face can unlock this account, and ask
  /// for one straight away the first time the screen shows it.
  Future<void> _checkBiometrics({bool prompt = false}) async {
    if (!mounted) return;
    final accountId = context.read<AuthCubit>().state.active?.id;
    final biometrics = context.read<BiometricUnlock>();
    final offer = accountId == null
        ? BiometricOffer.off
        : await biometrics.offerFor(accountId);
    if (!mounted) return;
    setState(() {
      _offer = offer;
      _offerFor = accountId;
    });
    if (prompt && offer == BiometricOffer.ready) await _unlockWithBiometrics();
  }

  Future<void> _unlockWithBiometrics() async {
    final accountId = context.read<AuthCubit>().state.active?.id;
    if (accountId == null || _loading) return;
    final biometrics = context.read<BiometricUnlock>();
    final vaultCubit = context.read<VaultCubit>();
    final cryptoCubit = context.read<VaultCryptoCubit>();

    setState(() {
      _loading = true;
      _error = null;
    });
    Uint8List? masterKey;
    try {
      masterKey = await biometrics.readMasterKey(accountId);
      // Backed out of the check: the passphrase field is right there
      if (masterKey == null) return _fail(null);
      final account = await vaultCubit.fetchAccount();
      final ok = await cryptoCubit.unlockAccountWithKey(
        account: account,
        masterKey: masterKey,
      );
      // On success the router moves on by itself
      if (!ok) {
        // The master passphrase was changed elsewhere: this key opens nothing now
        await biometrics.disable(accountId);
        _offer = BiometricOffer.off;
        _fail('Your master passphrase has changed. Enter it to unlock.');
      }
    } on BiometricInvalidated {
      _offer = BiometricOffer.off;
      _fail(
        'Fingerprints or faces on this phone changed. Enter your master passphrase, '
        'then turn fingerprint or face unlock on again in Settings.',
      );
    } on BiometricLockedOut {
      _fail('Too many attempts. Enter your master passphrase.');
    } on KeysNotYoursException catch (e) {
      _fail(e.toString());
    } catch (_) {
      _fail(
        'Could not unlock with fingerprint or face. Enter your master passphrase.',
      );
    } finally {
      if (masterKey != null) CryptoService.zero(masterKey);
    }
  }

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
    final biometrics = context.read<BiometricUnlock>();
    final accountId = context.read<AuthCubit>().state.active?.id;
    // Out of the field before the slow work starts
    _controller.clear();

    try {
      final account = await vaultCubit.fetchAccount();
      final ok = await cryptoCubit.unlockAccount(
        account: account,
        passphrase: passphrase,
      );
      // On success the router moves on by itself
      if (!ok) return _fail('Invalid passphrase');
      // Typed and right: fingerprint or face unlock is good for another while
      if (accountId != null) await biometrics.notePassphraseTyped(accountId);
    } on KeysNotYoursException catch (e) {
      _fail(e.toString());
    } catch (_) {
      _fail('Something went wrong');
    }
  }

  void _fail(String? message) {
    if (!mounted) return;
    setState(() {
      _error = message;
      _loading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final account = context.select((AuthCubit cubit) => cubit.state.active);
    // The account was switched from this screen: what was found out is not for it
    if (account?.id != _offerFor) {
      _offer = BiometricOffer.off;
      _offerFor = account?.id;
      WidgetsBinding.instance.addPostFrameCallback((_) => _checkBiometrics());
    }

    return Scaffold(
      body: SafeArea(
        // Scrolls when the keyboard leaves too little room
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const KuraBadge(size: 64),
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
                if (_offer == BiometricOffer.ready) ...[
                  const SizedBox(height: 12),
                  TextButton.icon(
                    onPressed: _loading ? null : _unlockWithBiometrics,
                    icon: const Icon(Icons.fingerprint),
                    label: const Text('Use fingerprint or face'),
                  ),
                ],
                if (_offer == BiometricOffer.passphraseDue) ...[
                  const SizedBox(height: 12),
                  const Text(
                    'Fingerprint or face unlock is on. Your master passphrase is '
                    'asked for every 7 days so it is not forgotten.',
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
