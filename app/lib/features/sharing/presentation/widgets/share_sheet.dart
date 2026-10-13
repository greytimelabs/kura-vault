import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/auth/auth_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_error.dart';
import '../../../users/data/users_api.dart';
import '../../data/members_api.dart';

/// Share a vault or one album. The key is sealed to the recipient's public key
/// on this device; the passphrase is never shared and the server only relays
/// ciphertext. Only people whose keys the owner certified are offered.
class ShareSheet extends StatefulWidget {
  /// `vault` or `album`.
  final String kind;
  final String id;
  final String name;

  const ShareSheet._({required this.kind, required this.id, required this.name});

  static Future<void> showForVault(BuildContext context,
          {required String vaultId, required String name}) =>
      _show(context, ShareSheet._(kind: 'vault', id: vaultId, name: name));

  /// The album's key must already be loaded (it is, once the album list or the
  /// album itself has been opened).
  static Future<void> showForAlbum(BuildContext context,
          {required String albumId, required String name}) =>
      _show(context, ShareSheet._(kind: 'album', id: albumId, name: name));

  static Future<void> _show(BuildContext context, ShareSheet sheet) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => sheet,
    );
  }

  @override
  State<ShareSheet> createState() => _ShareSheetState();
}

class _ShareSheetState extends State<ShareSheet> {
  static const _permissions = {
    'view': 'Can view',
    'write': 'Can view and add',
  };

  late final MembersApi _members = widget.kind == 'vault'
      ? MembersApi.vault(context.read<ApiClient>(), widget.id)
      : MembersApi.album(context.read<ApiClient>(), widget.id);
  late final UsersApi _users = UsersApi(context.read<ApiClient>());

  List<Member>? _current;
  List<UserKeys>? _people;
  String? _userId;
  String _permission = 'view';
  String? _busy;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadMembers();
    _loadPeople();
  }

  Future<void> _loadMembers() async {
    try {
      final members = await _members.list();
      if (mounted) setState(() => _current = members);
    } catch (e) {
      if (mounted) {
        setState(() {
          _current ??= const [];
          _error = apiErrorMessage(e, 'Could not load who has access');
        });
      }
    }
  }

  /// The server's list is a claim; keep only users whose certificate verifies
  /// against the owner key this account trusts.
  Future<void> _loadPeople() async {
    final crypto = context.read<VaultCryptoCubit>();
    final isOwner = context.read<AuthCubit>().state.active?.isOwner ?? false;
    try {
      // Someone who joined since the owner unlocked becomes shareable here
      if (isOwner) {
        try {
          await certifyPendingUsers(_users, crypto);
        } catch (_) {}
      }
      final users = await _users.directory();
      final verified = <UserKeys>[];
      for (final user in users) {
        if (await crypto.verifyUser(user)) verified.add(user);
      }
      if (mounted) setState(() => _people = verified);
    } catch (_) {
      if (mounted) setState(() => _people = const []);
    }
  }

  Future<void> _run(String id, Future<void> Function() work, String done) async {
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _busy = id;
      _error = null;
    });
    try {
      await work();
      messenger.showSnackBar(SnackBar(content: Text(done)));
    } catch (e) {
      if (mounted) {
        setState(() => _error = apiErrorMessage(e, 'Could not save the change'));
      }
    } finally {
      if (mounted) setState(() => _busy = null);
      await _loadMembers();
    }
  }

  void _share(UserKeys recipient) {
    final crypto = context.read<VaultCryptoCubit>();
    _run(
      'add',
      () async {
        // Checks the recipient's certificate again before sealing anything
        final grant = widget.kind == 'vault'
            ? await crypto.shareVault(vaultId: widget.id, recipient: recipient)
            : await crypto.shareAlbum(albumId: widget.id, recipient: recipient);
        await _members.add(
          userId: recipient.userId,
          permission: _permission,
          wrappedKey: grant.wrappedKey,
          grantSig: grant.grantSig,
        );
        if (mounted) setState(() => _userId = null);
      },
      'Shared ${widget.name} with ${recipient.username}',
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final members = _current ?? const <Member>[];
    final taken = {for (final m in members) m.userId};
    final candidates = [
      for (final user in _people ?? const <UserKeys>[])
        if (!taken.contains(user.userId)) user,
    ];
    final selected =
        candidates.where((user) => user.userId == _userId).firstOrNull;
    final others = members.where((m) => !m.isCreator).toList();

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(
            24, 0, 24, 16 + MediaQuery.of(context).viewInsets.bottom),
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Share ${widget.name}', style: theme.textTheme.titleLarge),
              const SizedBox(height: 4),
              Text(widget.kind == 'vault'
                  ? 'Everything in this vault, including every album.'
                  : 'Only this album. The rest of the vault stays private.'),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                key: ValueKey('share-with-${candidates.length}-$_userId'),
                initialValue: selected?.userId,
                isExpanded: true,
                decoration: const InputDecoration(
                  labelText: 'Share with',
                  border: OutlineInputBorder(),
                ),
                hint: Text(_people == null
                    ? 'Loading'
                    : candidates.isEmpty
                        ? 'Nobody to share with'
                        : 'Choose a user'),
                items: [
                  for (final user in candidates)
                    DropdownMenuItem(value: user.userId, child: Text(user.username)),
                ],
                onChanged: _busy != null || candidates.isEmpty
                    ? null
                    : (value) => setState(() => _userId = value),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _permission,
                      isExpanded: true,
                      decoration: const InputDecoration(
                        labelText: 'Permission',
                        border: OutlineInputBorder(),
                      ),
                      items: [
                        for (final entry in _permissions.entries)
                          DropdownMenuItem(value: entry.key, child: Text(entry.value)),
                      ],
                      onChanged: _busy != null
                          ? null
                          : (value) => setState(() => _permission = value ?? 'view'),
                    ),
                  ),
                  const SizedBox(width: 12),
                  FilledButton(
                    onPressed: selected == null || _busy != null
                        ? null
                        : () => _share(selected),
                    child: _busy == 'add'
                        ? const SizedBox(
                            height: 18,
                            width: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Share'),
                  ),
                ],
              ),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
              ],
              const SizedBox(height: 20),
              Text('PEOPLE WITH ACCESS', style: theme.textTheme.labelMedium),
              if (_current == null)
                const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(child: CircularProgressIndicator()),
                )
              else if (others.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 8),
                  child: Text('Only you.'),
                )
              else
                for (final member in others)
                  ListTile(
                    key: ValueKey('member-${member.username}'),
                    contentPadding: EdgeInsets.zero,
                    title: Text(member.username, overflow: TextOverflow.ellipsis),
                    subtitle: Text(_permissions[member.permission] ?? member.permission),
                    trailing: _busy == member.userId
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : PopupMenuButton<String>(
                            tooltip: 'Change access for ${member.username}',
                            enabled: _busy == null,
                            onSelected: (action) => action == 'remove'
                                ? _run(
                                    member.userId,
                                    () => _members.remove(member.userId),
                                    '${member.username} no longer has access',
                                  )
                                : _run(
                                    member.userId,
                                    () => _members.update(member.userId, action),
                                    'Updated ${member.username}',
                                  ),
                            itemBuilder: (_) => [
                              for (final entry in _permissions.entries)
                                CheckedPopupMenuItem(
                                  value: entry.key,
                                  checked: member.permission == entry.key,
                                  child: Text(entry.value),
                                ),
                              const PopupMenuDivider(),
                              const PopupMenuItem(
                                  value: 'remove', child: Text('Remove')),
                            ],
                          ),
                  ),
              const SizedBox(height: 12),
              Text(
                'Removing someone stops their access immediately. It cannot '
                'take back photos they already downloaded.',
                style: theme.textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
