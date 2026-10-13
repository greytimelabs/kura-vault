import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../../blocs/album/album_cubit.dart';
import '../../../../blocs/album/album_state.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../albums/album_names.dart';
import '../../../albums/presentation/widgets/album_card.dart';
import '../../../albums/presentation/widgets/album_name_dialog.dart';

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

  void _loadAlbums({bool quiet = false}) {
    final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
    if (vaultId != null) {
      context.read<AlbumCubit>().loadAlbums(vaultId, quiet: quiet);
    }
  }

  Future<void> _newAlbum(String vaultId) async {
    final albums = context.read<AlbumCubit>();
    final crypto = context.read<VaultCryptoCubit>();
    final messenger = ScaffoldMessenger.of(context);
    await AlbumNameDialog.show(
      context,
      title: 'New album',
      submitLabel: 'Create',
      onSubmit: (name) async {
        await albums.createAlbum(vaultId: vaultId, name: name, crypto: crypto);
        messenger.showSnackBar(SnackBar(content: Text('Created $name')));
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final crypto = context.watch<VaultCryptoCubit>();
    final vaultId = crypto.state.activeVaultId;

    return Scaffold(
      floatingActionButton: crypto.state.canOrganise && vaultId != null
          ? FloatingActionButton.extended(
              onPressed: () => _newAlbum(vaultId),
              icon: const Icon(Icons.create_new_folder_outlined),
              label: const Text('New album'),
            )
          : null,
      body: BlocBuilder<AlbumCubit, AlbumState>(
        builder: (context, state) {
          if (state.status == AlbumStatus.loading) {
            return const Center(child: CircularProgressIndicator());
          }
          if (state.status == AlbumStatus.error) {
            return Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('Error loading albums'),
                  const SizedBox(height: 16),
                  ElevatedButton(
                    onPressed: _loadAlbums,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            );
          }
          if (state.albums.isEmpty || vaultId == null) {
            return const Center(
              child: Text('No albums yet', style: TextStyle(fontSize: 18)),
            );
          }

          // Loads each album's key through the vault key and decrypts its name
          final names = albumNames(crypto, vaultId, state.albums);

          return GridView.builder(
            // Room for the button so it never covers the last row
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 88),
            gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
              crossAxisCount: 2,
              crossAxisSpacing: 8,
              mainAxisSpacing: 8,
              childAspectRatio: 0.85,
            ),
            itemCount: state.albums.length,
            itemBuilder: (context, index) {
              final album = state.albums[index];
              return AlbumCard(
                vaultId: vaultId,
                album: album,
                name: names[album.id],
                onTap: () async {
                  await context.push(
                    '/gallery/albums/${album.id}',
                    extra: album.isLiked,
                  );
                  // Counts may have changed while inside (e.g. unliking from the viewer)
                  if (mounted) _loadAlbums(quiet: true);
                },
              );
            },
          );
        },
      ),
    );
  }
}
