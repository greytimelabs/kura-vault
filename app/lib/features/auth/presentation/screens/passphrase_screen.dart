import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/vault/vault_cubit.dart';
import '../../../../core/storage/cache_service.dart';
import '../widgets/vault_picker_sheet.dart';

class PassphraseScreen extends StatefulWidget {
  const PassphraseScreen({super.key});

  @override
  State<PassphraseScreen> createState() => _PassphraseScreenState();
}

class _PassphraseScreenState extends State<PassphraseScreen> {
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
    final cacheService = context.read<CacheService>();

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
        // The same passphrase was set on more than one vault. Each derives a
        // different KEK (distinct salts), so every one of these verified
        // independently. Let the user say which to open.
        if (!mounted) {
          cryptoCubit.discardMatches(matches);
          return;
        }
        final picked = await VaultPickerSheet.show(context, matches);
        if (picked == null) {
          // Dismissed — never strand live KEKs in memory.
          cryptoCubit.discardMatches(matches);
          if (mounted) setState(() => _loading = false);
          return;
        }
        chosen = picked;
      }

      cryptoCubit.selectVault(chosen, matches);

      final cacheKey = cryptoCubit.state.cacheKey;
      if (cacheKey != null) {
        await cacheService.init(cacheKey);
      }

      if (mounted) {
        context.go('/gallery');
      }
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
                'Enter Passphrase',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 32),
              TextField(
                controller: _controller,
                obscureText: true,
                autofocus: true,
                decoration: InputDecoration(
                  hintText: 'Vault passphrase',
                  errorText: _error,
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
