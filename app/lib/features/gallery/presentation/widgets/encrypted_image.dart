import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:dio/dio.dart';
import '../../../../blocs/crypto/vault_crypto_cubit.dart';
import '../../../../core/storage/cache_service.dart';

/// Widget that fetches encrypted thumbnail from S3,
/// decrypts it client-side, and displays it.
/// Uses local encrypted cache for repeat views.
class EncryptedImage extends StatefulWidget {
  final String mediaId;
  final String thumbUrl;
  final MediaKeyRef? mediaKey;
  final String thumbIv;
  final double? width;
  final double? height;
  final BoxFit fit;

  const EncryptedImage({
    super.key,
    required this.mediaId,
    required this.thumbUrl,
    required this.mediaKey,
    required this.thumbIv,
    this.width,
    this.height,
    this.fit = BoxFit.cover,
  });

  @override
  State<EncryptedImage> createState() => _EncryptedImageState();
}

class _EncryptedImageState extends State<EncryptedImage> {
  Uint8List? _imageBytes;
  bool _loading = true;
  bool _error = false;

  @override
  void initState() {
    super.initState();
    _loadImage();
  }

  Future<void> _loadImage() async {
    try {
      final cacheService = context.read<CacheService>();

      // 1. Check cache first
      final cached = await cacheService.getThumb(widget.mediaId);
      if (cached != null && mounted) {
        setState(() {
          _imageBytes = cached;
          _loading = false;
        });
        return;
      }

      // 2. Fetch encrypted blob from S3
      final response = await Dio().get<List<int>>(
        widget.thumbUrl,
        options: Options(responseType: ResponseType.bytes),
      );
      final encryptedBytes = Uint8List.fromList(response.data!);

      // 3. Decrypt
      final cryptoCubit = context.read<VaultCryptoCubit>();
      final decrypted = cryptoCubit.decryptMedia(
        mediaId: widget.mediaId,
        tier: 'thumb',
        key: widget.mediaKey!,
        ivB64: widget.thumbIv,
        encryptedBlob: encryptedBytes,
      );

      // 4. Cache for next time
      await cacheService.putThumb(widget.mediaId, decrypted);

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

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return SizedBox(
        width: widget.width,
        height: widget.height,
        child: const Center(child: CircularProgressIndicator(strokeWidth: 2)),
      );
    }

    if (_error || _imageBytes == null) {
      return SizedBox(
        width: widget.width,
        height: widget.height,
        child: const Icon(Icons.broken_image, color: Colors.grey),
      );
    }

    return Image.memory(
      _imageBytes!,
      width: widget.width,
      height: widget.height,
      fit: widget.fit,
      gaplessPlayback: true,
    );
  }
}
