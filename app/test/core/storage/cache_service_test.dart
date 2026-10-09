import 'dart:io';
import 'dart:typed_data';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/core/storage/cache_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tempDir;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('cache_test');
    // Stub path_provider so getApplicationCacheDirectory() resolves in tests.
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (call) async => tempDir.path,
    );
  });

  tearDown(() async {
    if (await tempDir.exists()) await tempDir.delete(recursive: true);
  });

  Uint8List key(int seed) =>
      Uint8List.fromList(List<int>.generate(32, (i) => (seed * 7 + i) & 0xff));

  test('vault B does not read or destroy vault A cache for a shared photo',
      () async {
    // The same mediaId can live in two vaults via media_vault_access.
    const sharedMediaId = 'shared-media-id';
    final plain = Uint8List.fromList(List<int>.generate(64, (i) => i));

    final serviceA = CacheService();
    await serviceA.init(key(1));
    await serviceA.putThumb(sharedMediaId, plain);
    expect(await serviceA.getThumb(sharedMediaId), plain);

    // Lock, then unlock a different vault.
    serviceA.dispose();
    final serviceB = CacheService();
    await serviceB.init(key(2));

    // B sees no entry (rather than reading A's file and failing the GCM tag).
    expect(await serviceB.getThumb(sharedMediaId), isNull);

    // B caches its own copy.
    final plainB = Uint8List.fromList(List<int>.generate(64, (i) => 255 - i));
    await serviceB.putThumb(sharedMediaId, plainB);
    expect(await serviceB.getThumb(sharedMediaId), plainB);
    serviceB.dispose();

    // A's entry survived B's activity — no thrash.
    final serviceA2 = CacheService();
    await serviceA2.init(key(1));
    expect(await serviceA2.getThumb(sharedMediaId), plain);
  });

  test('legacy flat cache files are cleaned up on init', () async {
    final thumbs = Directory('${tempDir.path}/thumbs');
    await thumbs.create(recursive: true);
    final legacy = File('${thumbs.path}/old-media.enc');
    await legacy.writeAsBytes([1, 2, 3]);

    await CacheService().init(key(1));

    expect(await legacy.exists(), isFalse);
  });

  test('dispose zeroes the cache key', () async {
    final k = key(3);
    final service = CacheService();
    await service.init(k);
    service.dispose();
    expect(k.every((b) => b == 0), isTrue);
  });
}
