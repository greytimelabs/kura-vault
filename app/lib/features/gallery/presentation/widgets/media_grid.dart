import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import '../../../../blocs/media/media_cubit.dart';
import '../../../../blocs/media/media_state.dart';
import '../../../../blocs/selection/selection_cubit.dart';
import '../../../../core/format.dart';
import 'encrypted_image.dart';

class MediaGrid extends StatelessWidget {
  final List<MediaItem> items;

  /// Long-press picks a photo, and in selection mode a tap does too. Only for
  /// people who can file photos into albums.
  final bool selectable;

  const MediaGrid({super.key, required this.items, this.selectable = false});

  @override
  Widget build(BuildContext context) {
    final selection = selectable
        ? context.watch<SelectionCubit>().state
        : const SelectionState();

    return SliverGrid(
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 3,
        crossAxisSpacing: 2,
        mainAxisSpacing: 2,
      ),
      delegate: SliverChildBuilderDelegate(
        (context, index) {
          final item = items[index];
          final selected = selection.ids.contains(item.id);
          return GestureDetector(
            key: ValueKey(item.id),
            onTap: selection.active
                ? () => context.read<SelectionCubit>().toggle(item.id)
                : () => context.push('/viewer/${item.id}'),
            onLongPress: selectable
                ? () => context.read<SelectionCubit>().toggle(item.id)
                : null,
            child: Stack(
              fit: StackFit.expand,
              children: [
                AnimatedPadding(
                  duration: const Duration(milliseconds: 120),
                  padding: EdgeInsets.all(selected ? 8 : 0),
                  child: EncryptedImage(
                    mediaId: item.id,
                    thumbUrl: item.thumbUrl,
                    mediaKey: item.key,
                    thumbIv: item.thumbIv,
                    fit: BoxFit.cover,
                    onExpired: () => context.read<MediaCubit>().renewThumb(item.id),
                  ),
                ),
                if (item.mediaType == 'video')
                  Positioned(
                    right: 4,
                    bottom: 4,
                    child: _VideoBadge(seconds: item.durationSeconds),
                  ),
                if (selection.active)
                  Positioned(
                    top: 4,
                    left: 4,
                    child: _Check(selected: selected),
                  ),
              ],
            ),
          );
        },
        childCount: items.length,
      ),
    );
  }
}

class _VideoBadge extends StatelessWidget {
  final int? seconds;
  const _VideoBadge({required this.seconds});

  @override
  Widget build(BuildContext context) {
    final seconds = this.seconds;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 2),
      decoration: BoxDecoration(
        color: Colors.black54,
        borderRadius: BorderRadius.circular(10),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(Icons.play_arrow, size: 14, color: Colors.white),
          if (seconds != null && seconds > 0)
            Text(
              formatDuration(seconds),
              style: const TextStyle(fontSize: 11, color: Colors.white),
            ),
        ],
      ),
    );
  }
}

class _Check extends StatelessWidget {
  final bool selected;
  const _Check({required this.selected});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Semantics(
      label: selected ? 'Selected' : 'Not selected',
      child: Container(
        width: 22,
        height: 22,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: selected ? scheme.primary : Colors.black38,
          border: Border.all(color: Colors.white, width: 1.5),
        ),
        child: selected
            ? Icon(Icons.check, size: 15, color: scheme.onPrimary)
            : null,
      ),
    );
  }
}
