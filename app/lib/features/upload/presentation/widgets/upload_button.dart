import 'package:file_selector/file_selector.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:image_picker/image_picker.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/upload/upload_cubit.dart';

/// Add photos to the open vault, and to [albumId] when one is being shown.
/// Only shown to people who may add photos here.
class UploadButton extends StatelessWidget {
  /// The regular album on screen, if any. With only one album shared, that
  /// album is the only place an upload can go, whatever is passed here.
  final String? albumId;

  const UploadButton({super.key, this.albumId});

  static const _images = XTypeGroup(
    label: 'Photos',
    mimeTypes: ['image/*'],
    uniformTypeIdentifiers: ['public.image'],
  );

  Future<void> _choose(BuildContext context) async {
    final source = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Photo library'),
              subtitle: const Text('The app sees only the photos you pick'),
              onTap: () => Navigator.of(sheetContext).pop('library'),
            ),
            ListTile(
              leading: const Icon(Icons.folder_outlined),
              title: const Text('Files'),
              onTap: () => Navigator.of(sheetContext).pop('files'),
            ),
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: const Text('Take a photo'),
              subtitle: const Text('It goes into the vault, not into the device gallery'),
              onTap: () => Navigator.of(sheetContext).pop('camera'),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(24, 8, 24, 16),
              child: Text(
                'Photos are encrypted on this device before they are uploaded. '
                'Videos are uploaded from the web client.',
              ),
            ),
          ],
        ),
      ),
    );
    if (source == null || !context.mounted) return;

    final uploads = context.read<UploadCubit>();
    final crypto = context.read<VaultCryptoCubit>().state;
    final messenger = ScaffoldMessenger.of(context);
    final errorColor = Theme.of(context).colorScheme.error;
    final vaultId = crypto.activeVaultId;
    if (vaultId == null) return;
    final target = crypto.albumOnlyId ?? albumId;

    // The picker is another screen in front of the app: do not lock under it
    uploads.setPicking(true);
    List<XFile> files = const [];
    try {
      final picker = ImagePicker();
      switch (source) {
        case 'library':
          // No library permission: the system picker hands over only what is chosen
          files = await picker.pickMultiImage(requestFullMetadata: false);
        case 'files':
          files = await openFiles(acceptedTypeGroups: const [_images]);
        default:
          final shot = await picker.pickImage(
              source: ImageSource.camera, requestFullMetadata: false);
          files = [?shot];
      }
    } catch (_) {
      messenger.showSnackBar(SnackBar(
        content: Text(source == 'camera'
            ? 'The camera could not be opened'
            : 'Could not open the picker'),
        backgroundColor: errorColor,
      ));
    } finally {
      uploads.setPicking(false);
    }
    if (files.isEmpty) return;

    // The vault may have locked while the picker was open
    if (!uploads.canUploadTo(vaultId)) {
      uploads.discard(files);
      return;
    }
    final skipped = uploads.enqueue(files, vaultId: vaultId, albumId: target);
    if (skipped > 0) {
      messenger.showSnackBar(SnackBar(
        content: Text(skipped == files.length
            ? 'Only photos can be uploaded'
            : 'Skipped $skipped file${skipped == 1 ? '' : 's'} that '
                '${skipped == 1 ? 'is' : 'are'} not photos'),
        backgroundColor: errorColor,
      ));
    }
  }

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Upload',
      icon: const Icon(Icons.upload_outlined),
      onPressed: () => _choose(context),
    );
  }
}
