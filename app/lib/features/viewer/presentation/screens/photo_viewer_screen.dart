import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:photo_view/photo_view.dart';
import 'package:photo_view/photo_view_gallery.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/media/media_cubit.dart';
import '../../../../blocs/media/media_state.dart';
import '../../../../core/format.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/network/blob_fetch.dart';
import '../../../../core/platform/save_channel.dart';
import '../../../../core/storage/cache_service.dart';
import '../../../../core/storage/preferences.dart';
import '../../../../core/widgets/confirm_delete_dialog.dart';

/// One photo or video at a time, swiping through the list it was opened from.
class PhotoViewerScreen extends StatefulWidget {
  final String mediaId;

  const PhotoViewerScreen({super.key, required this.mediaId});

  /// A preview is a 1080-pixel JPEG; anything much larger is not one.
  static const int maxPreviewBytes = 30 * 1024 * 1024;

  /// Originals are decrypted in memory. Larger files are for the web client.
  static const int maxDownloadBytes = 100 * 1024 * 1024;

  @override
  State<PhotoViewerScreen> createState() => _PhotoViewerScreenState();
}

class _PhotoViewerScreenState extends State<PhotoViewerScreen> {
  static const _preloadDelay = Duration(milliseconds: 400);
  static const _keptPreviews = 4;

  late String _currentId = widget.mediaId;
  late final PageController _pages;

  /// Decrypted previews of the photos around the one on screen. Memory only,
  /// and gone with the viewer.
  final Map<String, Future<Uint8List>> _previews = {};
  Timer? _preload;
  bool _downloading = false;

  @override
  void initState() {
    super.initState();
    final items = context.read<MediaCubit>().state.items;
    final index = items.indexWhere((m) => m.id == widget.mediaId);
    _pages = PageController(initialPage: index < 0 ? 0 : index);
  }

  @override
  void dispose() {
    _preload?.cancel();
    _pages.dispose();
    _previews.clear();
    super.dispose();
  }

  Future<Uint8List> _preview(MediaItem item) {
    final known = _previews.remove(item.id);
    // Re-inserted so the most recently shown are the ones kept
    final loading = known ?? _loadPreview(item);
    _previews[item.id] = loading;
    while (_previews.length > _keptPreviews) {
      _previews.remove(_previews.keys.first);
    }
    // A failed load is not remembered: coming back to the photo tries again
    loading.catchError((Object _) {
      if (identical(_previews[item.id], loading)) _previews.remove(item.id);
      return Uint8List(0);
    });
    return loading;
  }

  Future<Uint8List> _loadPreview(MediaItem item) async {
    final key = item.key;
    if (key == null) throw StateError('No key for this item');
    final media = context.read<MediaCubit>();
    final crypto = context.read<VaultCryptoCubit>();
    // Links live for 60 seconds, so they are requested right before use
    final links = await media.urls(item.id);
    final blob = await fetchEncrypted(links.previewUrl,
        maxBytes: PhotoViewerScreen.maxPreviewBytes);
    return crypto.decryptMediaInBackground(
      mediaId: item.id,
      tier: 'preview',
      key: key,
      ivB64: links.previewIv,
      encryptedBlob: blob,
    );
  }

  void _onPageChanged(int index) {
    final media = context.read<MediaCubit>();
    final items = media.state.items;
    if (index < 0 || index >= items.length) return;
    setState(() => _currentId = items[index].id);

    // Reaching the end of what is loaded: fetch the next page so swiping keeps working
    if (index >= items.length - 3 && media.state.hasMore) media.loadNext();

    // Warm the next photo once this one has been on screen for a moment. One
    // at a time, after a pause, so flicking through does not flood the
    // rate-limited API.
    _preload?.cancel();
    if (index + 1 < items.length) {
      final next = items[index + 1];
      _preload = Timer(_preloadDelay, () async {
        try {
          await _preview(items[index]);
          if (mounted && _currentId == items[index].id) await _preview(next);
        } catch (_) {}
      });
    }
  }

  /// Erase the item on screen for good, then show the one after it.
  Future<void> _delete(MediaItem item) async {
    final media = context.read<MediaCubit>();
    final cache = context.read<CacheService>();
    final navigator = Navigator.of(context);
    final before = media.state.items;
    final index = before.indexWhere((m) => m.id == item.id);
    final after = index + 1 < before.length
        ? before[index + 1]
        : (index > 0 ? before[index - 1] : null);

    final deleted = await ConfirmDeleteDialog.show(
      context,
      title: 'Delete this item?',
      body: const [
        'It is erased from the vault and from every album, for everyone the vault is shared with. This cannot be undone.',
        'Copies that were already downloaded are not affected.',
      ],
      confirmLabel: 'Delete',
      onConfirm: (_) => media.deleteItems([item.id]),
    );
    if (!deleted) return;

    _previews.remove(item.id);
    unawaited(cache.removeThumb(item.id));
    if (!mounted) return;
    if (after == null) {
      navigator.pop();
      return;
    }
    setState(() => _currentId = after.id);
    // The list is one shorter: stay on the item that took this one's place
    final position = media.state.items.indexWhere((m) => m.id == after.id);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && position >= 0 && _pages.hasClients) _pages.jumpToPage(position);
    });
    _say('Deleted');
  }

  void _toggleLike() {
    final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
    if (vaultId == null) return;
    context.read<MediaCubit>().toggleLike(vaultId: vaultId, mediaId: _currentId);
  }

  void _say(String message, {bool error = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(message),
      backgroundColor: error ? Theme.of(context).colorScheme.error : null,
    ));
  }

  /// Decrypted metadata: file name and location. The server never sees them.
  Map<String, dynamic> _meta(MediaItem item) {
    final json = context.read<VaultCryptoCubit>().decryptMeta(
          mediaId: item.id,
          key: item.key,
          encrypted: item.encryptedMeta,
          nonce: item.metaNonce,
        );
    if (json == null) return const {};
    try {
      final decoded = jsonDecode(json);
      return decoded is Map<String, dynamic> ? decoded : const {};
    } catch (_) {
      return const {};
    }
  }

  void _showInfo(MediaItem item) {
    final meta = _meta(item);
    final lat = meta['gpsLatitude'];
    final lng = meta['gpsLongitude'];
    final seconds = item.durationSeconds;
    final rows = <(String, String?)>[
      ('Taken', formatDateTime(item.capturedAt)),
      ('Type', item.mediaType == 'video' ? 'Video' : 'Photo'),
      (
        'Dimensions',
        item.width != null && item.height != null
            ? '${item.width} × ${item.height}'
            : null
      ),
      ('Duration', seconds != null && seconds > 0 ? formatDuration(seconds) : null),
      ('File name', meta['filename'] is String ? meta['filename'] as String : null),
      (
        'Location',
        lat is num && lng is num
            ? '${lat.toStringAsFixed(5)}, ${lng.toStringAsFixed(5)}'
            : null
      ),
    ];
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
          children: [
            Text('Details', style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 8),
            for (final (label, value) in rows)
              if (value != null)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  dense: true,
                  title: Text(label),
                  subtitle: Text(value, style: Theme.of(context).textTheme.bodyLarge),
                ),
          ],
        ),
      ),
    );
  }

  static const _mimeByExtension = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'gif': 'image/gif',
    'avif': 'image/avif',
    'heic': 'image/heic',
    'heif': 'image/heif',
    'tif': 'image/tiff',
    'tiff': 'image/tiff',
  };

  /// Ask where the copy should go; null when dismissed.
  Future<String?> _askDestination() async {
    // Said once: after this the file is out of the vault's hands
    if (!await Preferences.savedCopiesNoticeShown()) {
      if (!mounted) return null;
      final ok = await showDialog<bool>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          title: const Text('Saved copies are not protected'),
          content: const Text(
            'A photo you save leaves the vault as an ordinary file. Other apps, '
            'device backups and cloud photo sync can read it, and locking this '
            'app does not hide it.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(true),
              child: const Text('Continue'),
            ),
          ],
        ),
      );
      if (ok != true) return null;
      await Preferences.setSavedCopiesNoticeShown();
    }
    if (!mounted) return null;
    return showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: const Text('Save to gallery'),
              subtitle: const Text('Add it to this device\'s photos'),
              onTap: () => Navigator.of(sheetContext).pop('gallery'),
            ),
            ListTile(
              leading: const Icon(Icons.folder_outlined),
              title: const Text('Save to files'),
              subtitle: const Text('Choose where to put it'),
              onTap: () => Navigator.of(sheetContext).pop('files'),
            ),
          ],
        ),
      ),
    );
  }

  /// Decrypt the original and hand it to the device.
  Future<void> _download(MediaItem item) async {
    final key = item.key;
    if (_downloading || key == null) return;
    final destination = await _askDestination();
    if (destination == null || !mounted) return;

    final media = context.read<MediaCubit>();
    final crypto = context.read<VaultCryptoCubit>();
    final meta = _meta(item);
    setState(() => _downloading = true);
    try {
      final links = await media.urls(item.id);
      final blob = await fetchEncrypted(links.originalUrl,
          maxBytes: PhotoViewerScreen.maxDownloadBytes);
      final plain = await crypto.decryptMediaInBackground(
        mediaId: item.id,
        tier: 'original',
        key: key,
        ivB64: links.originalIv,
        encryptedBlob: blob,
      );

      // Only the last path segment: a stored name must never steer where the file lands
      final stored = meta['filename'];
      var name = stored is String ? stored.split(RegExp(r'[\\/]')).last.trim() : '';
      if (name.isEmpty || name == '.' || name == '..') name = '${item.id}.jpg';
      final extension = name.contains('.') ? name.split('.').last.toLowerCase() : '';
      final mimeType = _mimeByExtension[extension] ?? 'application/octet-stream';

      if (destination == 'gallery') {
        await SaveChannel.toGallery(bytes: plain, name: name, mimeType: mimeType);
        _say('Saved to gallery');
      } else if (await SaveChannel.toFiles(bytes: plain, name: name, mimeType: mimeType)) {
        _say('Saved');
      }
    } on TooLargeException {
      _say('This file is larger than 100 MB. Download it in the web client.', error: true);
    } on PlatformException catch (e) {
      _say(
        e.code == 'denied'
            ? 'Permission to add photos was refused. Allow it in the system settings.'
            : 'Could not save this file',
        error: true,
      );
    } on StateError {
      // Locked while it was downloading: there is nothing to say on this screen
    } catch (e) {
      _say(apiErrorMessage(e, 'Could not download this file'), error: true);
    } finally {
      if (mounted) setState(() => _downloading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = context.select<MediaCubit, List<MediaItem>>((c) => c.state.items);
    final item = items.where((m) => m.id == _currentId).firstOrNull;

    // The photo is not in the list (the list changed, or was cleared by a lock)
    if (item == null) {
      return Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(
          backgroundColor: Colors.transparent,
          iconTheme: const IconThemeData(color: Colors.white),
        ),
        body: const Center(
          child: Text('Could not load this photo', style: TextStyle(color: Colors.white54)),
        ),
      );
    }

    final isVideo = item.mediaType == 'video';

    return Scaffold(
      backgroundColor: Colors.black,
      extendBodyBehindAppBar: true,
      appBar: AppBar(
        backgroundColor: Colors.black38,
        elevation: 0,
        iconTheme: const IconThemeData(color: Colors.white),
        title: Text(
          formatDateTime(item.capturedAt) ?? '',
          style: const TextStyle(color: Colors.white, fontSize: 15),
        ),
        actions: [
          IconButton(
            tooltip: item.isLiked ? 'Unlike' : 'Like',
            icon: Icon(
              item.isLiked ? Icons.favorite : Icons.favorite_border,
              color: item.isLiked ? Colors.redAccent : Colors.white,
            ),
            onPressed: _toggleLike,
          ),
          if (!isVideo)
            IconButton(
              tooltip: 'Download original',
              onPressed: _downloading || item.key == null ? null : () => _download(item),
              icon: _downloading
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.download_outlined),
            ),
          IconButton(
            tooltip: 'Info',
            icon: const Icon(Icons.info_outline),
            onPressed: () => _showInfo(item),
          ),
          // Erasing takes write access to the vault itself, not just one album
          if (context.select((VaultCryptoCubit c) => c.state.canOrganise))
            IconButton(
              tooltip: 'Delete',
              icon: const Icon(Icons.delete_outline),
              onPressed: () => _delete(item),
            ),
        ],
      ),
      body: PhotoViewGallery.builder(
        pageController: _pages,
        itemCount: items.length,
        onPageChanged: _onPageChanged,
        backgroundDecoration: const BoxDecoration(color: Colors.black),
        builder: (context, index) {
          final page = items[index];
          return PhotoViewGalleryPageOptions.customChild(
            // Videos are a still frame: nothing to zoom into
            disableGestures: page.mediaType == 'video',
            minScale: PhotoViewComputedScale.contained,
            maxScale: PhotoViewComputedScale.contained * 4,
            child: _ViewerPage(
              key: ValueKey(page.id),
              item: page,
              preview: _preview(page),
            ),
          );
        },
      ),
    );
  }
}

/// One item: its cached thumbnail at once, then the decrypted preview.
class _ViewerPage extends StatefulWidget {
  final MediaItem item;
  final Future<Uint8List> preview;

  const _ViewerPage({super.key, required this.item, required this.preview});

  @override
  State<_ViewerPage> createState() => _ViewerPageState();
}

class _ViewerPageState extends State<_ViewerPage> {
  Uint8List? _thumb;
  Uint8List? _preview;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    context.read<CacheService>().getThumb(widget.item.id).then((thumb) {
      if (mounted && thumb != null) setState(() => _thumb = thumb);
    });
    widget.preview.then((bytes) {
      if (mounted) setState(() => bytes.isEmpty ? _failed = true : _preview = bytes);
    }, onError: (Object _) {
      if (mounted) setState(() => _failed = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final isVideo = widget.item.mediaType == 'video';
    final bytes = _preview ?? _thumb;
    final seconds = widget.item.durationSeconds;

    return Stack(
      fit: StackFit.expand,
      children: [
        if (bytes != null)
          Image.memory(
            bytes,
            fit: BoxFit.contain,
            gaplessPlayback: true,
            // Decrypted, but not something this device can draw
            errorBuilder: (_, _, _) => const Center(
              child: Icon(Icons.broken_image, size: 64, color: Colors.white54),
            ),
          ),
        if (_preview == null && !_failed)
          const Center(child: CircularProgressIndicator(color: Colors.white70)),
        if (_failed && _thumb == null)
          Center(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.broken_image, size: 64, color: Colors.white54),
                const SizedBox(height: 16),
                Text('Could not load this ${isVideo ? 'video' : 'photo'}',
                    style: const TextStyle(color: Colors.white54)),
              ],
            ),
          ),
        if (isVideo)
          Align(
            alignment: Alignment.bottomCenter,
            child: SafeArea(
              child: Container(
                margin: const EdgeInsets.all(24),
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.black87,
                  borderRadius: BorderRadius.circular(24),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Icon(Icons.play_arrow, color: Colors.white, size: 18),
                    const SizedBox(width: 8),
                    Flexible(
                      child: Text(
                        'Video${seconds != null && seconds > 0 ? ' · ${formatDuration(seconds)}' : ''}'
                        ' — download in the web client to play',
                        style: const TextStyle(color: Colors.white),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
