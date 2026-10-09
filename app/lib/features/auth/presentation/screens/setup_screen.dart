import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:uuid/uuid.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/vault/vault_cubit.dart';
import '../../../../core/network/api_client.dart';
import '../widgets/secrets_fields.dart';

/// First run: the person holding the server's setup key creates the owner
/// account. The keys are generated here; the server receives only public keys
/// and ciphertext.
class SetupScreen extends StatefulWidget {
  final String serverUrl;

  const SetupScreen({super.key, required this.serverUrl});

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  static final _usernameRule = RegExp(r'^[a-z0-9][a-z0-9._-]{1,30}[a-z0-9]$');

  final _formKey = GlobalKey<FormState>();
  final _setupKey = TextEditingController();
  final _username = TextEditingController();
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  final _passphrase = TextEditingController();
  final _confirmPassphrase = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [_setupKey, _username, _password, _confirmPassword, _passphrase, _confirmPassphrase]) {
      c.clear();
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    final apiClient = context.read<ApiClient>();
    final authCubit = context.read<AuthCubit>();
    final cryptoCubit = context.read<VaultCryptoCubit>();
    final vaultCubit = context.read<VaultCubit>();
    final username = _username.text.trim().toLowerCase();
    final password = _password.text;
    final passphrase = _passphrase.text;

    try {
      final id = const Uuid().v4();
      final material = await cryptoCubit.createAccount(
        userId: id,
        username: username,
        passphrase: passphrase,
      );
      await apiClient.setup(serverUrl: widget.serverUrl, body: {
        'setupKey': _setupKey.text.trim(),
        'id': id,
        'username': username,
        'password': password,
        'keyCert': material.keyCert,
        ...material.toJson(),
      });

      // Signing in changes the active account, which locks everything; the
      // keys are then loaded back from the server with the passphrase.
      final ok = await authCubit.login(
        serverUrl: widget.serverUrl,
        username: username,
        password: password,
      );
      if (!ok) throw StateError('The account was created but sign-in failed. Sign in to continue.');
      await cryptoCubit.unlockAccount(
        account: await vaultCubit.fetchAccount(),
        passphrase: passphrase,
      );
    } catch (e) {
      cryptoCubit.lock();
      if (mounted) {
        setState(() {
          _error = e is DioException ? '${e.error}' : (e is StateError ? e.message : 'Setup failed');
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final host = Uri.parse(widget.serverUrl).authority;
    return Scaffold(
      appBar: AppBar(title: const Text('Set up Kura Vault')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              Text('Create the owner account on $host'),
              const SizedBox(height: 24),
              TextFormField(
                controller: _setupKey,
                enabled: !_loading,
                autocorrect: false,
                enableSuggestions: false,
                decoration: const InputDecoration(
                  labelText: 'Setup key',
                  helperText: "Printed in the server's log when it started. It works once.",
                  helperMaxLines: 2,
                  border: OutlineInputBorder(),
                ),
                validator: (value) => (value ?? '').trim().isEmpty ? 'Required' : null,
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _username,
                enabled: !_loading,
                autocorrect: false,
                decoration: const InputDecoration(
                  labelText: 'Username',
                  errorMaxLines: 2,
                  border: OutlineInputBorder(),
                ),
                validator: (value) => _usernameRule.hasMatch((value ?? '').trim().toLowerCase())
                    ? null
                    : '3 to 32 characters: lowercase letters, digits, dot, dash or underscore',
              ),
              const SizedBox(height: 16),
              SecretsFields(
                password: _password,
                confirmPassword: _confirmPassword,
                passphrase: _passphrase,
                confirmPassphrase: _confirmPassphrase,
                enabled: !_loading,
              ),
              if (_error != null) ...[
                const SizedBox(height: 16),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: 24),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: _loading ? null : _submit,
                  child: _loading
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Text('Create owner account'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
