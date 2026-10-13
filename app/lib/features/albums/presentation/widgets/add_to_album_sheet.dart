import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/album/album_cubit.dart';
import '../../../../blocs/album/album_state.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/media/media_state.dart';
import '../../album_names.dart';
import 'album_name_dialog.dart';

/// Choose the album the selected photos go into, or make a new one for them.
/// Returns true once they have been added.
class AddToAlbumSheet extends StatefulWidget {
  final String vaultId;
  final List<MediaItem> items;

  /// The album being shown, which the photos are already in.
  final String? excludeAlbumId;

  const AddToAlbumSheet({
    super.key,
    required this.vaultId,
    required this.items,
    this.excludeAlbumId,
  });

  static Future<bool> show(
    BuildContext context, {
    required String vaultId,
    required List<MediaItem> items,
    String? excludeAlbumId,
  }) async {
    final done = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (_) => AddToAlbumSheet(
          vaultId: vaultId, items: items, excludeAlbumId: excludeAlbumId),
    );
    return done ?? false;
  }

  @override
  State<AddToAlbumSheet> createState() => _AddToAlbumSheetState();
}

class _AddToAlbumSheetState extends State<AddToAlbumSheet> {
  String? _busyAlbumId;

  @override
  void initState() {
    super.initState();
    final albums = context.read<AlbumCubit>();
    if (albums.state.status != AlbumStatus.loaded) {
      albums.loadAlbums(widget.vaultId, quiet: true);
    }
  }

  Future<void> _addTo(String albumId, String albumName) async {
    final albums = context.read<AlbumCubit>();
    final crypto = context.read<VaultCryptoCubit>();
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final errorColor = Theme.of(context).colorScheme.error;
    setState(() => _busyAlbumId = albumId);
    try {
      final failed = await albums.changeMembership(
        vaultId: widget.vaultId,
        albumId: albumId,
        items: widget.items,
        add: true,
        crypto: crypto,
      );
      messenger.showSnackBar(failed > 0
          ? SnackBar(
              content: Text('${itemCount(failed)} could not be added to $albumName'),
              backgroundColor: errorColor,
            )
          : SnackBar(
              content: Text('Added ${itemCount(widget.items.length)} to $albumName')));
      if (mounted) navigator.pop(true);
    } finally {
      if (mounted) setState(() => _busyAlbumId = null);
    }
  }

  Future<void> _createAndAdd() async {
    final albums = context.read<AlbumCubit>();
    final crypto = context.read<VaultCryptoCubit>();
    String? newId;
    String? newName;
    await AlbumNameDialog.show(
      context,
      title: 'New album',
      submitLabel: 'Create and add',
      onSubmit: (name) async {
        newId = await albums.createAlbum(
            vaultId: widget.vaultId, name: name, crypto: crypto);
        newName = name;
      },
    );
    if (newId != null && mounted) await _addTo(newId!, newName!);
  }

  @override
  Widget build(BuildContext context) {
    final state = context.watch<AlbumCubit>().state;
    final crypto = context.read<VaultCryptoCubit>();
    // The Liked album is filled only by liking
    final choices = [
      for (final album in state.albums)
        if (!album.isLiked && album.id != widget.excludeAlbumId) album,
    ];
    final names = albumNames(crypto, widget.vaultId, choices);
    final busy = _busyAlbumId != null;

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Add to album', style: Theme.of(context).textTheme.titleLarge),
                Text('${itemCount(widget.items.length)} selected'),
              ],
            ),
          ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                ListTile(
                  leading: const Icon(Icons.add),
                  title: const Text('New album'),
                  enabled: !busy,
                  onTap: _createAndAdd,
                ),
                for (final album in choices)
                  ListTile(
                    leading: const Icon(Icons.photo_album_outlined),
                    title: Text(albumTitle(album, names), overflow: TextOverflow.ellipsis),
                    subtitle: Text(itemCount(album.mediaCount)),
                    enabled: !busy,
                    trailing: _busyAlbumId == album.id
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : null,
                    onTap: () => _addTo(album.id, albumTitle(album, names)),
                  ),
                if (state.status == AlbumStatus.loading)
                  const Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(child: CircularProgressIndicator()),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
