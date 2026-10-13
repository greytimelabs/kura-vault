import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/album/album_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/crypto/vault_crypto_state.dart';
import '../../../../blocs/media/media_cubit.dart';
import '../../../../blocs/media/media_state.dart';
import '../../../../blocs/selection/selection_cubit.dart';
import '../../../albums/album_names.dart';
import '../../../albums/presentation/widgets/album_name_dialog.dart';
import '../../../../core/widgets/confirm_delete_dialog.dart';
import '../../../sharing/presentation/widgets/share_sheet.dart';
import '../../../upload/presentation/widgets/upload_button.dart';
import '../../../upload/presentation/widgets/upload_status.dart';
import '../widgets/media_grid.dart';
import '../widgets/selection_bar.dart';
import '../widgets/space_menu.dart';

class AlbumMediaScreen extends StatefulWidget {
  final String albumId;
  final bool isLikedAlbum;

  const AlbumMediaScreen({
    super.key,
    required this.albumId,
    this.isLikedAlbum = false,
  });

  @override
  State<AlbumMediaScreen> createState() => _AlbumMediaScreenState();
}

class _AlbumMediaScreenState extends State<AlbumMediaScreen> {
  final _scrollController = ScrollController();
  late final SelectionCubit _selection = context.read<SelectionCubit>();

  @override
  void initState() {
    super.initState();
    _selection.clear();
    _loadInitial();
    _scrollController.addListener(_onScroll);
  }

  void _loadInitial() {
    final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
    if (vaultId != null) {
      context.read<MediaCubit>().loadMedia(
        vaultId: vaultId,
        albumId: widget.albumId,
      );
    }
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent * 0.7) {
      final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
      if (vaultId != null) {
        context.read<MediaCubit>().loadMore(
          vaultId: vaultId,
          albumId: widget.albumId,
        );
      }
    }
  }

  @override
  void dispose() {
    // A selection belongs to the screen it was made on
    _selection.clear();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _rename(String vaultId, String currentName) async {
    final albums = context.read<AlbumCubit>();
    final crypto = context.read<VaultCryptoCubit>();
    final messenger = ScaffoldMessenger.of(context);
    await AlbumNameDialog.show(
      context,
      title: 'Rename album',
      submitLabel: 'Save',
      initialName: currentName,
      onSubmit: (name) async {
        await albums.renameAlbum(
          vaultId: vaultId,
          albumId: widget.albumId,
          name: name,
          crypto: crypto,
        );
        messenger.showSnackBar(const SnackBar(content: Text('Album renamed')));
      },
    );
  }

  Future<void> _delete(String vaultId, String name, int items) async {
    final albums = context.read<AlbumCubit>();
    final crypto = context.read<VaultCryptoCubit>();
    final messenger = ScaffoldMessenger.of(context);
    final navigator = Navigator.of(context);
    final deleted = await ConfirmDeleteDialog.show(
      context,
      title: 'Delete $name?',
      body: [
        'The album is deleted. ${items == 1 ? 'Its 1 item stays' : 'Its $items items stay'} '
            'in the vault and in the timeline.',
        'Anyone this album alone was shared with can no longer see what was in it.',
      ],
      confirmLabel: 'Delete album',
      onConfirm: (_) => albums.deleteAlbum(
        vaultId: vaultId,
        albumId: widget.albumId,
        crypto: crypto,
      ),
    );
    if (!deleted) return;
    messenger.showSnackBar(SnackBar(content: Text('Deleted $name')));
    if (mounted) navigator.pop();
  }

  @override
  Widget build(BuildContext context) {
    final cryptoCubit = context.watch<VaultCryptoCubit>();
    final crypto = cryptoCubit.state;
    final vaultId = crypto.activeVaultId;
    final albums = context.watch<AlbumCubit>().state.albums;
    final album = albums.where((a) => a.id == widget.albumId).firstOrNull;
    final liked = widget.isLikedAlbum || (album?.isLiked ?? false);
    // With only this album shared there is no album list; its name came with the share
    final albumOnly = crypto.albumOnlyId == widget.albumId;

    final String title;
    if (liked) {
      title = 'Liked';
    } else if (albumOnly) {
      title = crypto.activeLabel ?? 'Shared album';
    } else if (album != null && vaultId != null) {
      title = albumTitle(album, albumNames(cryptoCubit, vaultId, [album]));
    } else {
      title = 'Album';
    }

    // Albums other than Liked can be edited by people who can change the vault
    final selectable = crypto.canOrganise && !liked;
    final selecting = context.select((SelectionCubit c) => c.state.active);
    final known = album != null && !liked && vaultId != null;

    return PopScope(
      // Back leaves selection mode before it leaves the album
      canPop: !selecting,
      onPopInvokedWithResult: (didPop, _) {
        if (!didPop) _selection.clear();
      },
      child: Scaffold(
        appBar: AppBar(
          title: BlocBuilder<MediaCubit, MediaState>(
            buildWhen: (a, b) => a.total != b.total || a.status != b.status,
            builder: (context, state) => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, overflow: TextOverflow.ellipsis),
                if (state.status == MediaStatus.loaded ||
                    state.status == MediaStatus.loadingMore)
                  Text(
                    itemCount(state.total),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
              ],
            ),
          ),
          actions: [
            // Into this album: the Liked album is filled only by liking
            if (crypto.canWrite && !liked)
              UploadButton(albumId: widget.albumId),
            if (selectable && !selecting)
              IconButton(
                tooltip: 'Select',
                icon: const Icon(Icons.check_circle_outline),
                onPressed: _selection.start,
              ),
            if (known && crypto.isCreator)
              IconButton(
                tooltip: 'Share',
                icon: const Icon(Icons.share_outlined),
                onPressed: () => ShareSheet.showForAlbum(
                  context,
                  albumId: widget.albumId,
                  name: title,
                ),
              ),
            if (known && crypto.canOrganise)
              IconButton(
                tooltip: 'Rename',
                icon: const Icon(Icons.edit_outlined),
                onPressed: () => _rename(vaultId, title),
              ),
            if (known && crypto.canOrganise)
              IconButton(
                tooltip: 'Delete album',
                icon: const Icon(Icons.delete_outline),
                onPressed: () => _delete(
                    vaultId, title, context.read<MediaCubit>().state.total),
              ),
            // With only this album shared, this screen is the whole app: the way
            // out and to Settings is here
            if (albumOnly) const SpaceMenu(),
          ],
        ),
        body: Column(
          children: [
            const UploadStatusBar(),
            Expanded(
              child: _body(context, crypto, vaultId, title, liked, selectable),
            ),
          ],
        ),
      ),
    );
  }

  Widget _body(
    BuildContext context,
    VaultCryptoState crypto,
    String? vaultId,
    String title,
    bool liked,
    bool selectable,
  ) {
    return BlocBuilder<MediaCubit, MediaState>(
      builder: (context, state) {
        if (state.status == MediaStatus.loading) {
          return const Center(child: CircularProgressIndicator());
        }
        if (state.status == MediaStatus.error) {
          return Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Text('Error loading media'),
                const SizedBox(height: 16),
                ElevatedButton(
                  onPressed: _loadInitial,
                  child: const Text('Retry'),
                ),
              ],
            ),
          );
        }

        // In the Liked album, a photo unliked from the viewer drops out right away
        final items = liked
            ? state.items.where((i) => i.isLiked).toList()
            : state.items;

        if (items.isEmpty) {
          return Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    liked ? 'No liked photos yet' : 'This album is empty',
                    style: const TextStyle(fontSize: 18),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    liked
                        ? 'Open a photo and use the heart to add it here.'
                        : crypto.canOrganise
                        ? 'Select photos in the timeline and choose Add to album, or upload here.'
                        : crypto.canWrite
                        ? 'Use Upload to add photos.'
                        : '',
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          );
        }

        return Stack(
          children: [
            CustomScrollView(
              controller: _scrollController,
              slivers: [
                MediaGrid(items: items, selectable: selectable),
                if (state.status == MediaStatus.loadingMore)
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: Center(child: CircularProgressIndicator()),
                    ),
                  ),
                // Room for the selection bar
                const SliverToBoxAdapter(child: SizedBox(height: 88)),
              ],
            ),
            if (selectable && vaultId != null)
              Align(
                alignment: Alignment.bottomCenter,
                child: SelectionBar(
                  vaultId: vaultId,
                  album: (id: widget.albumId, name: title),
                ),
              ),
          ],
        );
      },
    );
  }
}
