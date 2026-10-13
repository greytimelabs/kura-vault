import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/vault/vault_cubit.dart';
import '../../../../core/crypto/crypto_service.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/platform/biometric_channel.dart';
import '../../../../core/security/biometric_unlock.dart';

/// The switch for unlocking this account with a fingerprint or face. Off
/// until the user turns it on; turning it on takes the master passphrase and
/// one fingerprint or face check.
class BiometricSettingTile extends StatefulWidget {
  const BiometricSettingTile({super.key});

  @override
  State<BiometricSettingTile> createState() => _BiometricSettingTileState();
}

class _BiometricSettingTileState extends State<BiometricSettingTile> {
  BiometricStatus? _status;
  bool _enabled = false;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final biometrics = context.read<BiometricUnlock>();
    final accountId = context.read<AuthCubit>().state.active?.id;
    final status = await biometrics.deviceStatus();
    final enabled = accountId != null &&
        await biometrics.offerFor(accountId) != BiometricOffer.off;
    if (!mounted) return;
    setState(() {
      _status = status;
      _enabled = enabled;
    });
  }

  void _say(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? Theme.of(context).colorScheme.error : null,
    ));
  }

  Future<void> _turnOn(String accountId) async {
    final biometrics = context.read<BiometricUnlock>();
    final vaults = context.read<VaultCubit>();

    final passphrase = await showDialog<String>(
      context: context,
      builder: (_) => const _PassphraseDialog(),
    );
    if (passphrase == null || passphrase.isEmpty || !mounted) return;

    setState(() => _busy = true);
    try {
      final account = await vaults.fetchAccount();
      final masterKey = await VaultCryptoCubit.masterKeyFor(
          account: account, passphrase: passphrase);
      if (masterKey == null) {
        _say('Invalid passphrase', error: true);
        return;
      }
      try {
        if (await biometrics.enable(accountId, masterKey)) {
          _say('Fingerprint or face unlock is on');
        }
      } finally {
        CryptoService.zero(masterKey);
      }
    } on BiometricLockedOut {
      _say('Too many attempts. Try again later.', error: true);
    } catch (e) {
      _say(apiErrorMessage(e, 'Could not turn on fingerprint or face unlock'),
          error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
      await _load();
    }
  }

  Future<void> _turnOff(String accountId) async {
    setState(() => _busy = true);
    await context.read<BiometricUnlock>().disable(accountId);
    if (mounted) setState(() => _busy = false);
    await _load();
  }

  @override
  Widget build(BuildContext context) {
    final accountId = context.select((AuthCubit cubit) => cubit.state.active?.id);
    final status = _status;
    final usable = status == BiometricStatus.available && accountId != null;

    final String detail = switch (status) {
      null => 'Checking this phone…',
      BiometricStatus.unsupported =>
        'This phone has no fingerprint or face unlock strong enough to guard a key',
      BiometricStatus.notEnrolled =>
        "Set up a fingerprint or face in the phone's settings first",
      BiometricStatus.available =>
        'Instead of typing the master passphrase. It is still asked for every '
            '${BiometricUnlock.passphraseEvery.inDays} days, and after fingerprints or faces '
            'change on this phone. Vault passphrases are always typed',
    };

    return SwitchListTile(
      secondary: const Icon(Icons.fingerprint),
      title: const Text('Unlock with fingerprint or face'),
      subtitle: Text(detail),
      value: _enabled,
      onChanged: !usable || _busy
          ? null
          : (on) => on ? _turnOn(accountId) : _turnOff(accountId),
    );
  }
}

/// Asks for the master passphrase and hands it back; the field is emptied on
/// the way out.
class _PassphraseDialog extends StatefulWidget {
  const _PassphraseDialog();

  @override
  State<_PassphraseDialog> createState() => _PassphraseDialogState();
}

class _PassphraseDialogState extends State<_PassphraseDialog> {
  final _controller = TextEditingController();

  @override
  void dispose() {
    _controller.clear();
    _controller.dispose();
    super.dispose();
  }

  void _submit() {
    final value = _controller.text;
    _controller.clear();
    Navigator.of(context).pop(value);
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Turn on fingerprint or face unlock'),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Enter your master passphrase. Its key is then kept on this phone, '
            'where only a matching fingerprint or face can release it.',
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _controller,
            obscureText: true,
            autofocus: true,
            enableSuggestions: false,
            autocorrect: false,
            decoration: const InputDecoration(
              labelText: 'Master passphrase',
              border: OutlineInputBorder(),
            ),
            onSubmitted: (_) => _submit(),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        TextButton(onPressed: _submit, child: const Text('Continue')),
      ],
    );
  }
}
