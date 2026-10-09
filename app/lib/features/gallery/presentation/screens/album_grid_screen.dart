import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/album/album_cubit.dart';
import '../../../../blocs/album/album_state.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../albums/presentation/widgets/album_card.dart';
import 'package:go_router/go_router.dart';

class AlbumGridScreen extends StatefulWidget {
  const AlbumGridScreen({super.key});

  @override
  State<AlbumGridScreen> createState() => _AlbumGridScreenState();
}

class _AlbumGridScreenState extends State<AlbumGridScreen> {
  @override
  void initState() {
    super.initState();
    _loadAlbums();
  }

  void _loadAlbums() {
    final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
    if (vaultId != null) {
      context.read<AlbumCubit>().loadAlbums(vaultId);
    }
  }

  @override
  Widget build(BuildContext context) {
    return BlocBuilder<AlbumCubit, AlbumState>(
      builder: (context, state) {
        if (state.status == AlbumStatus.loading) {
          return const Center(child: CircularProgressIndicator());
        }

        if (state.albums.isEmpty) {
          return const Center(
            child: Text('No albums yet', style: TextStyle(fontSize: 18)),
          );
        }

        return GridView.builder(
          padding: const EdgeInsets.all(8),
          gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: 2,
            crossAxisSpacing: 8,
            mainAxisSpacing: 8,
            childAspectRatio: 1,
          ),
          itemCount: state.albums.length,
          itemBuilder: (context, index) {
            final album = state.albums[index];
            return AlbumCard(
              album: album,
              onTap: () async {
                await context.push(
                  '/gallery/albums/${album.id}',
                  extra: album.isLiked,
                );
                // Counts may have changed while inside (e.g. unliking from the viewer)
                if (mounted) _loadAlbums();
              },
            );
          },
        );
      },
    );
  }
}
