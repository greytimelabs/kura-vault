import 'package:flutter/material.dart';
import '../../../../blocs/album/album_state.dart';

class AlbumCard extends StatelessWidget {
  final AlbumItem album;

  /// Decrypted name. Null for the Liked album, or when it cannot be decrypted.
  final String? name;
  final VoidCallback? onTap;

  const AlbumCard({super.key, required this.album, this.name, this.onTap});

  @override
  Widget build(BuildContext context) {
    final isLiked = album.isLiked;

    return GestureDetector(
      onTap: onTap,
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(
          children: [
            Expanded(
              child: Container(
                color: Colors.grey[200],
                child: Center(
                  child: Icon(
                    isLiked ? Icons.favorite : Icons.photo_album,
                    size: 48,
                    color: isLiked ? Colors.redAccent : Colors.grey,
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(8),
              child: Row(
                children: [
                  const Icon(Icons.lock, size: 14, color: Colors.grey),
                  const SizedBox(width: 4),
                  Expanded(
                    child: Text(
                      '${isLiked ? 'Liked' : (name ?? 'Album')} · ${album.mediaCount} items',
                      style: Theme.of(context).textTheme.bodySmall,
                      overflow: TextOverflow.ellipsis,
                    ),
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
