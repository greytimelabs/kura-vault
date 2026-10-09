import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../../blocs/album/album_cubit.dart';
import '../../../../blocs/album/album_state.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../widgets/album_card.dart';

class AlbumsScreen extends StatefulWidget {
  const AlbumsScreen({super.key});

  @override
  State<AlbumsScreen> createState() => _AlbumsScreenState();
}

class _AlbumsScreenState extends State<AlbumsScreen> {
  @override
  void initState() {
    super.initState();
    final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
    if (vaultId != null) {
      context.read<AlbumCubit>().loadAlbums(vaultId);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Albums')),
      body: BlocBuilder<AlbumCubit, AlbumState>(
        builder: (context, state) {
          if (state.status == AlbumStatus.loading) {
            return const Center(child: CircularProgressIndicator());
          }

          if (state.status == AlbumStatus.error) {
            return Center(child: Text(state.errorMessage ?? 'Error'));
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
            ),
            itemCount: state.albums.length,
            itemBuilder: (context, index) {
              final album = state.albums[index];
              return AlbumCard(
                album: album,
                onTap: () => context.push('/gallery/albums/${album.id}'),
              );
            },
          );
        },
      ),
    );
  }
}
