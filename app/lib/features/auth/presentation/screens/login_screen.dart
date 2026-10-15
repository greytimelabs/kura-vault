import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/auth/auth_state.dart';
import '../../../../core/widgets/kura_mark.dart';
import '../widgets/account_switcher_sheet.dart';

/// Second step of signing in: username + password on [serverUrl].
///
/// With [username] given this is a return to a saved account whose login
/// expired, so only the password is asked.
class LoginScreen extends StatefulWidget {
  final String serverUrl;
  final String? username;
  final bool adding;

  const LoginScreen({
    super.key,
    required this.serverUrl,
    this.username,
    this.adding = false,
  });

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  late final _usernameController = TextEditingController(text: widget.username);
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  bool get _returning => widget.username != null;

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.clear();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _login() async {
    if (!_formKey.currentState!.validate()) return;

    // On success the active account changes and the app moves on to the
    // passphrase screen by itself.
    final ok = await context.read<AuthCubit>().login(
          serverUrl: widget.serverUrl,
          username: _usernameController.text.trim(),
          password: _passwordController.text,
        );
    if (!ok) _passwordController.clear();
  }

  /// Pick a different server. Going back works when this screen was reached
  /// from the server screen; a saved account opens straight here.
  void _changeServer() {
    if (context.canPop()) {
      context.pop();
    } else {
      context.go(Uri(path: '/server', queryParameters: {
        'url': widget.serverUrl,
      }).toString());
    }
  }

  @override
  Widget build(BuildContext context) {
    final host = Uri.parse(widget.serverUrl).authority;
    final hasAccounts = context.watch<AuthCubit>().state.accounts.isNotEmpty;

    return Scaffold(
      appBar: widget.adding || context.canPop()
          ? AppBar(title: Text(_returning ? 'Sign in again' : 'Sign in'))
          : null,
      body: BlocListener<AuthCubit, AuthState>(
        listenWhen: (prev, curr) =>
            curr.errorMessage != null && prev.errorMessage != curr.errorMessage,
        listener: (context, state) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(state.errorMessage ?? 'Login failed')),
          );
        },
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(24),
              child: Form(
                key: _formKey,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const KuraBadge(size: 64),
                    const SizedBox(height: 16),
                    Text(
                      'Kura Vault',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                    const SizedBox(height: 24),
                    ListTile(
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                        side: BorderSide(color: Theme.of(context).dividerColor),
                      ),
                      leading: const Icon(Icons.dns_outlined),
                      title: Text(host, overflow: TextOverflow.ellipsis),
                      subtitle: Text(widget.serverUrl.startsWith('http://')
                          ? 'Server · not encrypted'
                          : 'Server'),
                      trailing: TextButton(
                        onPressed: _changeServer,
                        child: const Text('Change'),
                      ),
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _usernameController,
                      readOnly: _returning,
                      autofocus: !_returning,
                      autocorrect: false,
                      enableSuggestions: false,
                      textInputAction: TextInputAction.next,
                      autofillHints: const [AutofillHints.username],
                      decoration: const InputDecoration(
                        labelText: 'Username',
                        border: OutlineInputBorder(),
                        prefixIcon: Icon(Icons.person_outline),
                      ),
                      validator: (v) =>
                          v == null || v.trim().isEmpty ? 'Required' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _passwordController,
                      obscureText: _obscurePassword,
                      autofocus: _returning,
                      decoration: InputDecoration(
                        labelText: 'Password',
                        border: const OutlineInputBorder(),
                        prefixIcon: const Icon(Icons.lock),
                        suffixIcon: IconButton(
                          icon: Icon(_obscurePassword
                              ? Icons.visibility
                              : Icons.visibility_off),
                          onPressed: () =>
                              setState(() => _obscurePassword = !_obscurePassword),
                        ),
                      ),
                      onFieldSubmitted: (_) => _login(),
                      validator: (v) =>
                          v == null || v.isEmpty ? 'Required' : null,
                    ),
                    const SizedBox(height: 24),
                    BlocBuilder<AuthCubit, AuthState>(
                      builder: (context, state) {
                        return SizedBox(
                          height: 48,
                          child: ElevatedButton(
                            onPressed: state.busy ? null : _login,
                            child: state.busy
                                ? const SizedBox(
                                    height: 20,
                                    width: 20,
                                    child:
                                        CircularProgressIndicator(strokeWidth: 2),
                                  )
                                : const Text('Login'),
                          ),
                        );
                      },
                    ),
                    if (hasAccounts && !widget.adding) ...[
                      const SizedBox(height: 12),
                      TextButton(
                        onPressed: () => AccountSwitcherSheet.show(context),
                        child: const Text('Switch account'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
