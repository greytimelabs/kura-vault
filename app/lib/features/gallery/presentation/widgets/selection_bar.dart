import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/album/album_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/media/media_cubit.dart';
import '../../../../blocs/selection/selection_cubit.dart';
import '../../../../core/storage/cache_service.dart';
import '../../../../core/widgets/confirm_delete_dialog.dart';
import '../../../albums/album_names.dart';
import '../../../albums/presentation/widgets/add_to_album_sheet.dart';

/// Actions for the selected photos. Only for people who can change the vault.
/// Renders nothing until selection mode is on.
class SelectionBar extends StatefulWidget {
  final String vaultId;

  /// Set when showing a regular album, which enables "Remove".
  final ({String id, String name})? album;

  const SelectionBar({super.key, required this.vaultId, this.album});

  @override
  State<SelectionBar> createState() => _SelectionBarState();
}

class _SelectionBarState extends State<SelectionBar> {
  bool _removing = false;

  Future<void> _add(Set<String> ids) async {
    final selection = context.read<SelectionCubit>();
    final items = [
      for (final item in context.read<MediaCubit>().state.items)
        if (ids.contains(item.id)) item,
    ];
    final added = await AddToAlbumSheet.show(
      context,
      vaultId: widget.vaultId,
      items: items,
      excludeAlbumId: widget.album?.id,
    );
    if (added) selection.clear();
  }

  Future<void> _remove(Set<String> ids) async {
    final album = widget.album;
    if (album == null) return;
    final selection = context.read<SelectionCubit>();
    final media = context.read<MediaCubit>();
    final albums = context.read<AlbumCubit>();
    final crypto = context.read<VaultCryptoCubit>();
    final messenger = ScaffoldMessenger.of(context);
    final errorColor = Theme.of(context).colorScheme.error;
    final items = [
      for (final item in media.state.items)
        if (ids.contains(item.id)) item,
    ];
    setState(() => _removing = true);
    try {
      final failed = await albums.changeMembership(
        vaultId: widget.vaultId,
        albumId: album.id,
        items: items,
        add: false,
        crypto: crypto,
      );
      messenger.showSnackBar(failed > 0
          ? SnackBar(
              content: Text('${itemCount(failed)} could not be removed'),
              backgroundColor: errorColor,
            )
          : SnackBar(
              content: Text('Removed ${itemCount(items.length)} from ${album.name}')));
      selection.clear();
      await media.loadMedia(vaultId: widget.vaultId, albumId: album.id);
    } finally {
      if (mounted) setState(() => _removing = false);
    }
  }

  Future<void> _delete(Set<String> ids) async {
    final selection = context.read<SelectionCubit>();
    final media = context.read<MediaCubit>();
    final albums = context.read<AlbumCubit>();
    final cache = context.read<CacheService>();
    final messenger = ScaffoldMessenger.of(context);
    final count = ids.length;
    final deleted = await ConfirmDeleteDialog.show(
      context,
      title: 'Delete ${itemCount(count)}?',
      body: [
        '${count == 1 ? 'This item is' : 'These items are'} erased from the vault and from every album, '
            'for everyone the vault is shared with. This cannot be undone.',
        'Copies that were already downloaded are not affected.',
      ],
      confirmLabel: 'Delete',
      onConfirm: (_) => media.deleteItems(ids.toList()),
    );
    if (!deleted) return;
    for (final id in ids) {
      unawaited(cache.removeThumb(id));
    }
    selection.clear();
    messenger.showSnackBar(SnackBar(content: Text('Deleted ${itemCount(count)}')));
    // Album counts and covers changed
    unawaited(albums.loadAlbums(widget.vaultId, quiet: true));
  }

  @override
  Widget build(BuildContext context) {
    final selection = context.watch<SelectionCubit>().state;
    if (!selection.active) return const SizedBox.shrink();
    final count = selection.ids.length;
    final scheme = Theme.of(context).colorScheme;

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Material(
          elevation: 6,
          color: scheme.surfaceContainerHigh,
          borderRadius: BorderRadius.circular(32),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
            child: Row(
              children: [
                IconButton(
                  tooltip: 'Clear selection',
                  icon: const Icon(Icons.close),
                  onPressed: () => context.read<SelectionCubit>().clear(),
                ),
                Expanded(
                  child: Text(
                    '$count selected',
                    style: const TextStyle(fontWeight: FontWeight.w600),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                TextButton.icon(
                  onPressed: count == 0 || _removing ? null : () => _add(selection.ids),
                  icon: const Icon(Icons.create_new_folder_outlined),
                  label: const Text('Add to album'),
                ),
                if (widget.album != null)
                  _removing
                      ? const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 16),
                          child: SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          ),
                        )
                      : IconButton(
                          tooltip: 'Remove from album',
                          color: scheme.error,
                          icon: const Icon(Icons.folder_off_outlined),
                          onPressed: count == 0 ? null : () => _remove(selection.ids),
                        ),
                IconButton(
                  tooltip: 'Delete',
                  color: scheme.error,
                  icon: const Icon(Icons.delete_outline),
                  onPressed:
                      count == 0 || _removing ? null : () => _delete(selection.ids),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
