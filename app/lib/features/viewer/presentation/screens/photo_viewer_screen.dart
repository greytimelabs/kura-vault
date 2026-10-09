import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:dio/dio.dart';
import 'package:photo_view/photo_view.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../blocs/media/media_cubit.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';

class PhotoViewerScreen extends StatefulWidget {
  final String mediaId;

  const PhotoViewerScreen({super.key, required this.mediaId});

  @override
  State<PhotoViewerScreen> createState() => _PhotoViewerScreenState();
}

class _PhotoViewerScreenState extends State<PhotoViewerScreen> {
  Uint8List? _imageBytes;
  bool _loading = true;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _loadPreview();
  }

  Future<void> _loadPreview() async {
    try {
      final cryptoCubit = context.read<VaultCryptoCubit>();
      final apiClient = context.read<ApiClient>();
      // The item, with its wrapped key, comes from the list it was opened from
      final item = context
          .read<MediaCubit>()
          .state
          .items
          .where((m) => m.id == widget.mediaId)
          .firstOrNull;
      final key = item?.key;
      if (key == null) throw StateError('No key for this item');

      // Links live for 60 seconds, so they are requested right before use
      final response = await apiClient.dio.get(ApiEndpoints.mediaUrls(widget.mediaId));
      final data = response.data['data'] as Map<String, dynamic>;

      // Fetch the encrypted preview from storage
      final blobResponse = await Dio().get<List<int>>(
        data['previewUrl'] as String,
        options: Options(responseType: ResponseType.bytes),
      );

      final decrypted = cryptoCubit.decryptMedia(
        mediaId: widget.mediaId,
        tier: 'preview',
        key: key,
        ivB64: data['previewIv'] as String,
        encryptedBlob: Uint8List.fromList(blobResponse.data!),
      );
      if (mounted) {
        setState(() {
          _imageBytes = decrypted;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = true;
          _loading = false;
        });
      }
    }
  }

  void _toggleLike() {
    final vaultId = context.read<VaultCryptoCubit>().state.activeVaultId;
    if (vaultId == null) return;
    context.read<MediaCubit>().toggleLike(vaultId: vaultId, mediaId: widget.mediaId);
  }

  @override
  Widget build(BuildContext context) {
    // Null when this media isn't in the loaded list, so there is no state to show
    final isLiked = context.select<MediaCubit, bool?>((cubit) {
      for (final item in cubit.state.items) {
        if (item.id == widget.mediaId) return item.isLiked;
      }
      return null;
    });

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        iconTheme: const IconThemeData(color: Colors.white),
        actions: [
          if (isLiked != null)
            IconButton(
              tooltip: isLiked ? 'Unlike' : 'Like',
              icon: Icon(
                isLiked ? Icons.favorite : Icons.favorite_border,
                color: isLiked ? Colors.redAccent : Colors.white,
              ),
              onPressed: _toggleLike,
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: Colors.white))
          : _imageBytes != null
              ? PhotoView(
                  imageProvider: MemoryImage(_imageBytes!),
                  minScale: PhotoViewComputedScale.contained,
                  maxScale: PhotoViewComputedScale.covered * 3,
                )
              : const Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.broken_image, size: 64, color: Colors.white54),
                      SizedBox(height: 16),
                      Text('Could not load image',
                          style: TextStyle(color: Colors.white54)),
                    ],
                  ),
                ),
    );
  }
}
