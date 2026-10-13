import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/vault/vault_cubit.dart';
import '../../../../core/network/api_error.dart';

/// Make a vault: a separate set of photos with its own passphrase.
///
/// Returns the new vault with its live key, or null when cancelled. The caller
/// must either open it with [VaultCryptoCubit.selectVault] or zero it with
/// [VaultCryptoCubit.discardMatches] — never simply drop it.
class CreateVaultDialog extends StatefulWidget {
  const CreateVaultDialog({super.key});

  static const int minPassphraseLength = 12;

  static Future<MatchedVault?> show(BuildContext context) {
    return showDialog<MatchedVault>(
      context: context,
      barrierDismissible: false,
      builder: (_) => const CreateVaultDialog(),
    );
  }

  @override
  State<CreateVaultDialog> createState() => _CreateVaultDialogState();
}

class _CreateVaultDialogState extends State<CreateVaultDialog> {
  final _label = TextEditingController();
  final _passphrase = TextEditingController();
  final _confirm = TextEditingController();
  bool _busy = false;
  bool _touched = false;
  String? _error;

  @override
  void dispose() {
    // Never leave a passphrase sitting in a closed dialog
    _passphrase.clear();
    _confirm.clear();
    _label.dispose();
    _passphrase.dispose();
    _confirm.dispose();
    super.dispose();
  }

  bool get _tooShort =>
      _passphrase.text.length < CreateVaultDialog.minPassphraseLength;
  bool get _mismatch => _passphrase.text != _confirm.text;

  Future<void> _submit() async {
    setState(() => _touched = true);
    if (_tooShort || _mismatch || _busy) return;

    // Captured before any await: using context across an async gap is unsafe.
    final crypto = context.read<VaultCryptoCubit>();
    final vaults = context.read<VaultCubit>();
    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final made = await crypto.createVault(
        passphrase: _passphrase.text,
        label: _label.text,
      );
      try {
        await vaults.createVault(made.vault);
      } catch (_) {
        crypto.discardMatches([made.match]);
        rethrow;
      }
      _passphrase.clear();
      _confirm.clear();
      if (!mounted) {
        crypto.discardMatches([made.match]);
        return;
      }
      navigator.pop(made.match);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = apiErrorMessage(e, 'Could not create the vault');
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return PopScope(
      canPop: !_busy,
      child: AlertDialog(
        title: const Text('Create a vault'),
        scrollable: true,
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Text(
                'A vault is a separate set of photos with its own passphrase.'),
            const SizedBox(height: 16),
            TextField(
              controller: _label,
              enabled: !_busy,
              maxLength: 60,
              autofocus: true,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(
                labelText: 'Name',
                hintText: 'Family',
                helperText: 'Encrypted. Shown only after the vault is unlocked.',
                helperMaxLines: 2,
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: _passphrase,
              enabled: !_busy,
              obscureText: true,
              enableSuggestions: false,
              autocorrect: false,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: 'Passphrase',
                errorText: _touched && _tooShort
                    ? 'Use at least ${CreateVaultDialog.minPassphraseLength} characters'
                    : null,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            TextField(
              controller: _confirm,
              enabled: !_busy,
              obscureText: true,
              enableSuggestions: false,
              autocorrect: false,
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => _submit(),
              decoration: InputDecoration(
                labelText: 'Confirm passphrase',
                errorText: _touched && !_tooShort && _mismatch
                    ? 'Passphrases do not match'
                    : null,
                border: const OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 16),
            Text(
              'There is no way to recover or reset this passphrase. If it is '
              'lost, everything in the vault is lost with it.',
              style: theme.textTheme.bodySmall,
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
            ],
          ],
        ),
        actions: [
          TextButton(
            onPressed: _busy ? null : () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Create vault'),
          ),
        ],
      ),
    );
  }
}
