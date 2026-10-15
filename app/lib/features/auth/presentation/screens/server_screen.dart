import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/server/server_url.dart';
import '../../../../core/widgets/kura_mark.dart';
import '../widgets/account_switcher_sheet.dart';

/// First step of signing in: which server to talk to.
///
/// Shown at first launch and when adding another account ([adding]).
class ServerScreen extends StatefulWidget {
  final bool adding;
  final String? initialUrl;

  const ServerScreen({super.key, this.adding = false, this.initialUrl});

  @override
  State<ServerScreen> createState() => _ServerScreenState();
}

class _ServerScreenState extends State<ServerScreen> {
  late final _controller = TextEditingController(text: widget.initialUrl);
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final ServerUrl typed;
    try {
      typed = ServerUrl.parse(_controller.text);
    } on ServerUrlException catch (e) {
      setState(() => _error = e.message);
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    final apiClient = context.read<ApiClient>();
    try {
      var server = typed;
      bool setupRequired;
      try {
        setupRequired = await apiClient.checkServer(server.value);
      } on ServerCheckException {
        // A local server typed without a scheme may simply have no TLS.
        final fallback = typed.httpFallback;
        if (fallback == null) rethrow;
        setupRequired = await apiClient.checkServer(fallback.value);
        server = fallback;
      }

      if (!mounted) return;
      if (server.isInsecure && !await _confirmInsecure(server)) {
        if (mounted) setState(() => _loading = false);
        return;
      }
      if (!mounted) return;
      setState(() => _loading = false);

      // A server with no owner yet goes to first-run setup instead of sign-in
      context.push(Uri(path: setupRequired ? '/setup' : '/login', queryParameters: {
        'server': server.value,
        if (widget.adding) 'add': '1',
      }).toString());
    } on ServerCheckException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    }
  }

  Future<bool> _confirmInsecure(ServerUrl server) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        icon: const Icon(Icons.warning_amber_rounded),
        title: const Text('Connection is not encrypted'),
        content: Text(
          '${server.value} uses http. Your password and session can be read '
          'by anyone on the same network. Your photos stay encrypted.\n\n'
          'Only continue on a network you trust.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Continue'),
          ),
        ],
      ),
    );
    return confirmed ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final hasAccounts = context.watch<AuthCubit>().state.accounts.isNotEmpty;

    return Scaffold(
      appBar: widget.adding ? AppBar(title: const Text('Add account')) : null,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
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
                const SizedBox(height: 8),
                Text(
                  'Enter the address of your Kura Vault server',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium,
                ),
                const SizedBox(height: 32),
                TextField(
                  controller: _controller,
                  autofocus: true,
                  autocorrect: false,
                  enableSuggestions: false,
                  keyboardType: TextInputType.url,
                  textInputAction: TextInputAction.go,
                  decoration: InputDecoration(
                    labelText: 'Server URL',
                    hintText: 'https://vault.example.com',
                    errorText: _error,
                    errorMaxLines: 3,
                    border: const OutlineInputBorder(),
                    prefixIcon: const Icon(Icons.dns_outlined),
                  ),
                  onSubmitted: (_) => _connect(),
                ),
                const SizedBox(height: 24),
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: _loading ? null : _connect,
                    child: _loading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Connect'),
                  ),
                ),
                const SizedBox(height: 12),
                TextButton(
                  // Accounts are created by the server owner; the link says which server
                  onPressed: () => context.push('/join'),
                  child: const Text('I have an invite link'),
                ),
                if (hasAccounts && !widget.adding) ...[
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () => AccountSwitcherSheet.show(context),
                    child: const Text('Use a saved account'),
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
