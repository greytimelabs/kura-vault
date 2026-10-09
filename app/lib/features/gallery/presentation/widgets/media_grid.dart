import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../../../../blocs/media/media_state.dart';
import 'encrypted_image.dart';

class MediaGrid extends StatelessWidget {
  final List<MediaItem> items;

  const MediaGrid({super.key, required this.items});

  @override
  Widget build(BuildContext context) {
    return SliverGrid(
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 2,
        mainAxisSpacing: 2,
      ),
      delegate: SliverChildBuilderDelegate(
        (context, index) {
          final item = items[index];
          return GestureDetector(
            onTap: () => context.push('/viewer/${item.id}'),
            child: EncryptedImage(
              mediaId: item.id,
              thumbUrl: item.thumbUrl,
              mediaKey: item.key,
              thumbIv: item.thumbIv,
              fit: BoxFit.cover,
            ),
          );
        },
        childCount: items.length,
      ),
    );
  }
}
