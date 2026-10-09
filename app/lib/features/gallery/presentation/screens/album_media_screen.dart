import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/media/media_cubit.dart';
import '../../../../blocs/media/media_state.dart';
import '../widgets/media_grid.dart';

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

  @override
  void initState() {
    super.initState();
    _loadInitial();
    _scrollController.addListener(_onScroll);
  }

  void _loadInitial() {
    final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
    if (vaultId != null) {
      context.read<MediaCubit>().loadMedia(vaultId: vaultId, albumId: widget.albumId);
    }
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent * 0.7) {
      final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
      if (vaultId != null) {
        context.read<MediaCubit>().loadMore(vaultId: vaultId, albumId: widget.albumId);
      }
    }
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.isLikedAlbum ? 'Liked' : 'Album')),
      body: BlocBuilder<MediaCubit, MediaState>(
        builder: (context, state) {
          if (state.status == MediaStatus.loading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state.status == MediaStatus.error) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(state.errorMessage ?? 'Error loading media'),
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
          final items = widget.isLikedAlbum
              ? state.items.where((i) => i.isLiked).toList()
              : state.items;

          if (items.isEmpty) {
            return Center(
              child: Text(
                widget.isLikedAlbum ? 'No liked photos yet' : 'This album is empty',
                style: const TextStyle(fontSize: 18),
              ),
            );
          }

          return CustomScrollView(
            controller: _scrollController,
            slivers: [
              MediaGrid(items: items),
              if (state.status == MediaStatus.loadingMore)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}
