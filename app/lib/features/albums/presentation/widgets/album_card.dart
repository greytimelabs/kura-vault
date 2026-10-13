import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/album/album_state.dart';
import '../../../../blocs/media/media_state.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';
import '../../../gallery/presentation/widgets/encrypted_image.dart';
import '../../album_names.dart';

class AlbumCard extends StatelessWidget {
  final String vaultId;
  final AlbumItem album;

  /// Decrypted name. Null for the Liked album, or when it cannot be decrypted.
  final String? name;
  final VoidCallback? onTap;

  const AlbumCard({
    super.key,
    required this.vaultId,
    required this.album,
    this.name,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final isLiked = album.isLiked;
    final title = isLiked ? 'Liked' : (name ?? 'Untitled album');

    return GestureDetector(
      onTap: onTap,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: Stack(
                fit: StackFit.expand,
                children: [
                  _AlbumCover(
                    // A changed count may mean a different first photo
                    key: ValueKey('${album.id}:${album.mediaCount}'),
                    vaultId: vaultId,
                    album: album,
                  ),
                  if (isLiked)
                    const Positioned(
                      top: 8,
                      left: 8,
                      child: CircleAvatar(
                        radius: 14,
                        backgroundColor: Colors.black54,
                        child: Icon(Icons.favorite, size: 16, color: Colors.redAccent),
                      ),
                    ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 8, 2),
              child: Text(
                title,
                style: Theme.of(context).textTheme.titleSmall,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
              child: Row(
                children: [
                  const Icon(Icons.lock, size: 12, color: Colors.grey),
                  const SizedBox(width: 4),
                  Text(
                    itemCount(album.mediaCount),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// First item of an album, used as its cover.
class _AlbumCover extends StatefulWidget {
  final String vaultId;
  final AlbumItem album;

  const _AlbumCover({super.key, required this.vaultId, required this.album});

  @override
  State<_AlbumCover> createState() => _AlbumCoverState();
}

class _AlbumCoverState extends State<_AlbumCover> {
  MediaItem? _cover;

  @override
  void initState() {
    super.initState();
    if (widget.album.mediaCount > 0) _load();
  }

  Future<void> _load() async {
    try {
      final response = await context.read<ApiClient>().dio.get(
        ApiEndpoints.media,
        queryParameters: {
          'vaultId': widget.vaultId,
          'albumId': widget.album.id,
          'page': 1,
          'limit': 1,
        },
      );
      final items = (response.data['data'] as Map<String, dynamic>)['data'] as List<dynamic>;
      if (items.isEmpty || !mounted) return;
      setState(() => _cover = MediaItem.fromJson(items.first as Map<String, dynamic>));
    } catch (_) {
      // The placeholder stays
    }
  }

  @override
  Widget build(BuildContext context) {
    final cover = _cover;
    if (cover == null || cover.key == null) {
      return ColoredBox(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        child: Icon(
          widget.album.isLiked ? Icons.favorite : Icons.photo_album,
          size: 48,
          color: widget.album.isLiked ? Colors.redAccent : Colors.grey,
        ),
      );
    }
    return EncryptedImage(
      mediaId: cover.id,
      thumbUrl: cover.thumbUrl,
      mediaKey: cover.key,
      thumbIv: cover.thumbIv,
      fit: BoxFit.cover,
    );
  }
}
