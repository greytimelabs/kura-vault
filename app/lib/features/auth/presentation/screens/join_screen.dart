import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/vault/vault_cubit.dart';
import '../../../../core/crypto/identity_crypto.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/server/server_url.dart';
import '../widgets/secrets_fields.dart';

/// Join with an invite link from the server owner. The link's fragment (never
/// sent to any server) carries the secret that proves this person's new keys
/// to the owner, and the owner's key that this account will trust from now on.
class JoinScreen extends StatefulWidget {
  /// A link the app was opened with, if any.
  final String? initialLink;

  const JoinScreen({super.key, this.initialLink});

  @override
  State<JoinScreen> createState() => _JoinScreenState();
}

class _JoinScreenState extends State<JoinScreen> {
  final _formKey = GlobalKey<FormState>();
  late final _link = TextEditingController(text: widget.initialLink);
  final _password = TextEditingController();
  final _confirmPassword = TextEditingController();
  final _passphrase = TextEditingController();
  final _confirmPassphrase = TextEditingController();

  bool _loading = false;
  String? _error;

  // Set once the link has been read and the server has confirmed it
  InviteLink? _invite;
  String? _serverUrl;
  String? _token;
  String? _userId;
  String? _username;

  @override
  void initState() {
    super.initState();
    if (widget.initialLink != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) => _readLink());
    }
  }

  @override
  void dispose() {
    for (final c in [_link, _password, _confirmPassword, _passphrase, _confirmPassphrase]) {
      c.clear();
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _readLink() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final apiClient = context.read<ApiClient>();
    try {
      final invite = InviteLink.parse(_link.text);
      final server = invite.server;
      if (server == null) {
        throw const FormatException('This invite does not say which server it is for.');
      }
      final serverUrl = ServerUrl.parse(server).value;
      await apiClient.checkServer(serverUrl);

      final token = b64e(await IdentityCrypto.inviteAuthToken(b64d(invite.secret)));
      final info = await apiClient.getInvite(
        serverUrl: serverUrl,
        inviteId: invite.inviteId,
        token: token,
      );
      // The link names the owner this account will trust. A server that is not
      // that owner's must not be joined.
      if (info['ownerPublicSignKey'] != invite.ownerSignKey) {
        throw const FormatException(
            'This server is not the one the invite was made for. Do not continue.');
      }
      // The secret does not need to stay on screen
      _link.clear();
      setState(() {
        _invite = invite;
        _serverUrl = serverUrl;
        _token = token;
        _userId = info['userId'] as String;
        _username = info['username'] as String;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _loading = false;
        _error = switch (e) {
          FormatException() => e.message,
          ServerUrlException() => e.message,
          ServerCheckException() => e.message,
          DioException() when e.response?.statusCode == 404 =>
            'This invite has expired or was already used. Ask the owner for a new one.',
          _ => 'This invite could not be opened.',
        };
      });
    }
  }

  Future<void> _join() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });

    final apiClient = context.read<ApiClient>();
    final authCubit = context.read<AuthCubit>();
    final cryptoCubit = context.read<VaultCryptoCubit>();
    final vaultCubit = context.read<VaultCubit>();
    final password = _password.text;
    final passphrase = _passphrase.text;

    try {
      final material = await cryptoCubit.createAccount(
        userId: _userId!,
        username: _username!,
        passphrase: passphrase,
        invite: _invite,
      );
      await apiClient.acceptInvite(
        serverUrl: _serverUrl!,
        inviteId: _invite!.inviteId,
        body: {
          'token': _token,
          'password': password,
          'keyBinding': material.keyBinding,
          ...material.toJson(),
        },
      );

      // Signing in changes the active account, which locks everything; the
      // keys are then loaded back from the server with the passphrase.
      final ok = await authCubit.login(
        serverUrl: _serverUrl!,
        username: _username!,
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
          _error = e is DioException
              ? '${e.error}'
              : (e is StateError ? e.message : 'Could not create the account');
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final ready = _invite != null;
    return Scaffold(
      appBar: AppBar(title: const Text('Join with an invite')),
      body: SafeArea(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(24),
            children: [
              if (!ready) ...[
                const Text('Paste the invite link the server owner sent you.'),
                const SizedBox(height: 16),
                TextField(
                  controller: _link,
                  enabled: !_loading,
                  autocorrect: false,
                  enableSuggestions: false,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Invite link',
                    border: OutlineInputBorder(),
                  ),
                ),
              ] else ...[
                Text('Set up your account on ${Uri.parse(_serverUrl!).authority}'),
                const SizedBox(height: 16),
                InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Username',
                    border: OutlineInputBorder(),
                  ),
                  child: Text(_username!),
                ),
                const SizedBox(height: 16),
                SecretsFields(
                  password: _password,
                  confirmPassword: _confirmPassword,
                  passphrase: _passphrase,
                  confirmPassphrase: _confirmPassphrase,
                  enabled: !_loading,
                ),
              ],
              if (_error != null) ...[
                const SizedBox(height: 16),
                Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ],
              const SizedBox(height: 24),
              SizedBox(
                height: 48,
                child: ElevatedButton(
                  onPressed: _loading ? null : (ready ? _join : _readLink),
                  child: _loading
                      ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                      : Text(ready ? 'Create account' : 'Continue'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
