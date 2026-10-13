import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import '../../../../blocs/upload/upload_cubit.dart';
import '../../../../blocs/upload/upload_state.dart';

/// One line saying how the uploads are going; tap for the list. Renders
/// nothing when there are none.
class UploadStatusBar extends StatelessWidget {
  const UploadStatusBar({super.key});

  @override
  Widget build(BuildContext context) {
    final state = context.watch<UploadCubit>().state;
    if (state.items.isEmpty) return const SizedBox.shrink();
    final scheme = Theme.of(context).colorScheme;

    return Material(
      color: state.failed > 0 && state.active == 0
          ? scheme.errorContainer
          : scheme.secondaryContainer,
      child: InkWell(
        onTap: () => showModalBottomSheet<void>(
          context: context,
          isScrollControlled: true,
          showDragHandle: true,
          builder: (_) => const _UploadList(),
        ),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          child: Row(
            children: [
              if (state.active > 0)
                const SizedBox(
                  height: 16,
                  width: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              else
                Icon(state.failed > 0 ? Icons.error_outline : Icons.check_circle_outline,
                    size: 18),
              const SizedBox(width: 12),
              Expanded(child: Text(state.summary)),
              if (state.active == 0)
                IconButton(
                  tooltip: 'Dismiss',
                  visualDensity: VisualDensity.compact,
                  icon: const Icon(Icons.close, size: 18),
                  onPressed: () => context.read<UploadCubit>().clearSettled(),
                )
              else
                const Icon(Icons.expand_less, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}

class _UploadList extends StatelessWidget {
  const _UploadList();

  static const _statusText = {
    UploadStatus.queued: 'Waiting',
    UploadStatus.processing: 'Preparing',
    UploadStatus.encrypting: 'Encrypting',
    UploadStatus.uploading: 'Uploading',
    UploadStatus.done: 'Uploaded',
    UploadStatus.failed: 'Failed',
  };

  @override
  Widget build(BuildContext context) {
    final state = context.watch<UploadCubit>().state;
    final scheme = Theme.of(context).colorScheme;

    return SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 8),
            child: Text(
              state.items.isEmpty ? 'Uploads' : state.summary,
              style: Theme.of(context).textTheme.titleLarge,
            ),
          ),
          if (state.active > 0)
            const Padding(
              padding: EdgeInsets.fromLTRB(24, 0, 24, 8),
              child: Text('Keep the app open: uploads pause when it is in the background.'),
            ),
          Flexible(
            child: ListView(
              shrinkWrap: true,
              children: [
                for (final item in state.items)
                  ListTile(
                    leading: switch (item.status) {
                      UploadStatus.done => Icon(Icons.check_circle, color: scheme.primary),
                      UploadStatus.failed => Icon(Icons.error, color: scheme.error),
                      _ => const Icon(Icons.schedule),
                    },
                    title: Text(item.name, overflow: TextOverflow.ellipsis),
                    subtitle: item.status == UploadStatus.uploading
                        ? Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text('Uploading ${(item.progress * 100).round()}%'),
                              const SizedBox(height: 4),
                              LinearProgressIndicator(value: item.progress),
                            ],
                          )
                        : Text(
                            item.status == UploadStatus.failed
                                ? (item.error ?? 'Upload failed')
                                : _statusText[item.status]!,
                          ),
                    trailing: item.status == UploadStatus.failed
                        ? IconButton(
                            tooltip: 'Retry',
                            icon: const Icon(Icons.refresh),
                            onPressed: () => context.read<UploadCubit>().retry(item.id),
                          )
                        : null,
                  ),
              ],
            ),
          ),
          if (state.active == 0 && state.items.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 8, 24, 8),
              child: OutlinedButton(
                onPressed: () {
                  context.read<UploadCubit>().clearSettled();
                  Navigator.of(context).pop();
                },
                child: const Text('Dismiss'),
              ),
            ),
        ],
      ),
    );
  }
}
