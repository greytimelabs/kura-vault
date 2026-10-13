// The real app, on a device or simulator, against a real backend: signs in,
// reads what the web client made (and does not see what it deleted), deletes
// a photo, an album and a vault, then makes a vault, an album and an upload of
// its own for the web client to read back.
//
// Needs the stack from web/tests/interop/stack.ts running and seeded:
//   cd web && pnpm exec tsx tests/interop/stack.ts            (leave running)
//   cd web && pnpm exec tsx tests/interop/web-side.ts seed
//   cd app && flutter test integration_test/interop_test.dart -d <device>
//   cd web && pnpm exec tsx tests/interop/web-side.ts verify
import 'dart:io';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:cryptography/cryptography.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image_picker/image_picker.dart' show XFile;
import 'package:integration_test/integration_test.dart';
import 'package:kura_vault/app.dart';
import 'package:kura_vault/blocs/album/album_cubit.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/blocs/upload/upload_cubit.dart';
import 'package:kura_vault/blocs/upload/upload_state.dart';
import 'package:kura_vault/features/gallery/presentation/widgets/encrypted_image.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Shared with web/tests/e2e/env.ts and web/tests/interop/web-side.ts
const server = 'http://localhost:3100';
const ownerName = 'e2e-owner';
const ownerPassword = 'Owner-Passw0rd!-e2e';
const ownerPassphrase = 'owner master passphrase for e2e';
const webVaultPassphrase = 'made on the web passphrase';
const appVaultPassphrase = 'made in the app passphrase';
const doomedVaultPassphrase = 'doomed vault passphrase';

extension on WidgetTester {
  /// Real work is going on (network, key derivation), so wait for what should
  /// appear rather than for the screen to go quiet.
  Future<void> waitFor(Finder finder, {Duration timeout = const Duration(seconds: 30)}) async {
    final end = DateTime.now().add(timeout);
    while (finder.evaluate().isEmpty) {
      if (DateTime.now().isAfter(end)) {
        // What the screen says instead, so a failure explains itself
        final shown = find.byType(Text).evaluate().map((e) => (e.widget as Text).data).nonNulls.join(' | ');
        fail('Timed out waiting for $finder. On screen: $shown');
      }
      await pump(const Duration(milliseconds: 100));
    }
    await pump(const Duration(milliseconds: 300));
  }

  Future<void> tapOn(Finder finder) async {
    await waitFor(finder);
    // Below the fold on a small screen
    await ensureVisible(finder.first);
    await pump(const Duration(milliseconds: 200));
    await tap(finder.first);
    await pump(const Duration(milliseconds: 400));
  }

  /// Leave a pushed screen and let it finish sliding away.
  Future<void> back() async {
    await pageBack();
    await pump(const Duration(milliseconds: 900));
  }

  Future<void> type(String field, String text) async {
    final finder = find.widgetWithText(TextField, field);
    await waitFor(finder);
    await enterText(finder.first, text);
    await pump(const Duration(milliseconds: 100));
  }
}

/// A real photo to upload: 1600×1200, so both derived tiers have to be scaled.
Future<Uint8List> makePhoto() async {
  final recorder = ui.PictureRecorder();
  final canvas = Canvas(recorder);
  canvas.drawRect(const Rect.fromLTWH(0, 0, 1600, 1200), Paint()..color = const Color(0xFF2E7D32));
  canvas.drawCircle(const Offset(800, 600), 400, Paint()..color = const Color(0xFFFFC107));
  final image = await recorder.endRecording().toImage(1600, 1200);
  final data = await image.toByteData(format: ui.ImageByteFormat.png);
  return data!.buffer.asUint8List();
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('app and web client read what the other wrote', (tester) async {
    // Whatever an earlier run left signed in
    await const FlutterSecureStorage().deleteAll();
    // The keychain files items by how they were saved; the app saves device-only
    await const FlutterSecureStorage(
      iOptions: IOSOptions(accessibility: KeychainAccessibility.unlocked_this_device),
    ).deleteAll();
    await (await SharedPreferences.getInstance()).clear();

    await tester.pumpWidget(const KuraVaultApp());

    // ── Sign in and unlock ──
    await tester.type('Server URL', server);
    await tester.tapOn(find.text('Connect'));
    await tester.waitFor(find.text('Login').evaluate().isEmpty ? find.text('Continue') : find.text('Login'));
    if (find.text('Continue').evaluate().isNotEmpty) await tester.tapOn(find.text('Continue'));
    await tester.type('Username', ownerName);
    await tester.type('Password', ownerPassword);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Login'));
    await tester.type('Master passphrase', ownerPassphrase);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Unlock'));

    // ── What the web client made opens here ──
    await tester.waitFor(find.text('Open a vault'));
    await tester.type('Vault passphrase', webVaultPassphrase);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Open'));
    await tester.waitFor(find.text('Web vault'));
    // Its photos: fetched from storage, decrypted, shown. The one the web
    // client deleted is not among them.
    final decrypted = find.descendant(of: find.byType(EncryptedImage), matching: find.byType(Image));
    await tester.waitFor(decrypted);
    await tester.pump(const Duration(seconds: 2));
    expect(find.byType(EncryptedImage), findsNWidgets(2));
    await tester.tapOn(find.byType(EncryptedImage));
    await tester.tapOn(find.byTooltip('Info'));
    await tester.waitFor(find.text('from-web.png'));
    expect(find.text('48.85837, 2.29448'), findsOneWidget);
    await tester.tapAt(const Offset(20, 80));
    await tester.pump(const Duration(milliseconds: 500));
    // ── Delete a photo: swipe to the second one and erase it ──
    await tester.fling(find.byType(Scaffold).last, const Offset(-400, 0), 1500);
    await tester.pump(const Duration(seconds: 1));
    await tester.tapOn(find.byTooltip('Info'));
    await tester.waitFor(find.text('delete-me.png'));
    await tester.tapAt(const Offset(20, 80));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tapOn(find.byTooltip('Delete'));
    await tester.waitFor(find.text('Delete this item?'));
    await tester.tapOn(find.widgetWithText(TextButton, 'Delete'));
    await tester.waitFor(find.text('Deleted'));
    // The viewer stays, on the photo that is left
    await tester.tapOn(find.byTooltip('Info'));
    await tester.waitFor(find.text('from-web.png'));
    await tester.tapAt(const Offset(20, 80));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.back();
    await tester.pump(const Duration(seconds: 1));
    expect(find.byType(EncryptedImage), findsOneWidget);

    // ── Albums: the one deleted on the web is gone; delete another here ──
    await tester.tapOn(find.text('Albums'));
    await tester.waitFor(find.text('Web album'));
    expect(find.text('1 item'), findsWidgets);
    expect(find.text('Deleted on the web'), findsNothing);
    await tester.tapOn(find.text('Doomed album'));
    await tester.tapOn(find.byTooltip('Delete album'));
    await tester.waitFor(find.text('Delete Doomed album?'));
    await tester.tapOn(find.widgetWithText(TextButton, 'Delete album'));
    await tester.waitFor(find.text('Web album'));
    await tester.pump(const Duration(seconds: 1));
    expect(find.text('Doomed album'), findsNothing);

    // ── Delete a whole vault: only with its passphrase ──
    await tester.tapOn(find.byTooltip('More'));
    await tester.tapOn(find.text('Close vault'));
    await tester.waitFor(find.text('Open a vault'));
    await tester.type('Vault passphrase', doomedVaultPassphrase);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Open'));
    await tester.waitFor(find.text('Doomed vault'));
    await tester.tapOn(find.byTooltip('More'));
    await tester.tapOn(find.text('Settings'));
    await tester.tapOn(find.text('Delete this vault'));
    await tester.waitFor(find.text('Delete Doomed vault?'));
    expect(find.textContaining('1 item and every album'), findsOneWidget);
    await tester.type('Vault passphrase', 'not its passphrase');
    await tester.tapOn(find.widgetWithText(TextButton, 'Delete vault'));
    await tester.waitFor(find.text('Wrong passphrase'));
    await tester.type('Vault passphrase', doomedVaultPassphrase);
    await tester.tapOn(find.widgetWithText(TextButton, 'Delete vault'));
    await tester.waitFor(find.text('Open a vault'));
    // Its passphrase opens nothing now
    await tester.type('Vault passphrase', doomedVaultPassphrase);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Open'));
    await tester.waitFor(find.text('Invalid passphrase'));
    expect(find.text('Doomed vault'), findsNothing);

    // ── Make a vault here ──
    await tester.tapOn(find.text('Create a vault'));
    await tester.type('Name', 'App vault');
    await tester.type('Passphrase', appVaultPassphrase);
    await tester.type('Confirm passphrase', appVaultPassphrase);
    await tester.tapOn(find.text('Create vault'));
    await tester.waitFor(find.text('App vault'));
    await tester.waitFor(find.text('No photos yet'));

    // ── An album in it ──
    await tester.tapOn(find.text('Albums'));
    await tester.tapOn(find.text('New album'));
    await tester.type('Album name', 'App album');
    await tester.tapOn(find.text('Create'));
    await tester.waitFor(find.text('App album'));
    await tester.tapOn(find.text('App album'));
    await tester.waitFor(find.text('This album is empty'));

    // ── A photo into the album. The system picker cannot be driven from a
    // test, so the file is handed to the queue the way the picker would ──
    final context = tester.element(find.text('This album is empty'));
    final crypto = context.read<VaultCryptoCubit>();
    final uploads = context.read<UploadCubit>();
    final albums = context.read<AlbumCubit>();
    final vaultId = crypto.state.activeVaultId!;
    final albumId = albums.state.albums.firstWhere((a) => !a.isLiked).id;

    final photo = await makePhoto();
    final hash = await Sha256().hash(photo);
    final name = 'fixture-${hash.bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join()}.png';
    final picked = File('${Directory.systemTemp.path}/$name');
    await picked.writeAsBytes(photo);

    expect(uploads.enqueue([XFile(picked.path)], vaultId: vaultId, albumId: albumId), 0);
    await tester.waitFor(find.text('1 uploaded'), timeout: const Duration(seconds: 90));
    expect(uploads.state.items.single.status, UploadStatus.done,
        reason: uploads.state.items.single.error);
    // The plaintext copy the picker would have left is gone
    await tester.pump(const Duration(seconds: 1));
    expect(await picked.exists(), false, reason: 'the picked copy must be deleted after upload');

    // It appears in the album, opens, and its details decrypt
    await tester.waitFor(find.descendant(of: find.byType(EncryptedImage), matching: find.byType(Image)));
    expect(find.text('1 item'), findsOneWidget);
    await tester.tapOn(find.byType(EncryptedImage));
    await tester.tapOn(find.byTooltip('Info'));
    await tester.waitFor(find.text(name));
    expect(find.text('1600 × 1200'), findsOneWidget);
    await tester.tapAt(const Offset(20, 80));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.back();
    await tester.back();

    // ── Sharing, users and settings are there for the owner ──
    await tester.tapOn(find.byTooltip('More'));
    await tester.tapOn(find.text('Settings'));
    await tester.waitFor(find.text('Share this vault'));
    expect(find.text('Lock automatically'), findsOneWidget);
    await tester.tapOn(find.text('Users'));
    await tester.waitFor(find.text(ownerName));
    expect(find.text('Keys verified'), findsOneWidget);
    await tester.back();
    await tester.tapOn(find.text('Dark'));
    expect(tester.widget<MaterialApp>(find.byType(MaterialApp)).themeMode, ThemeMode.dark);

    // ── Lock: every key gone, back to the master passphrase ──
    // Back up the list: Lock is above what is on screen now
    await tester.drag(find.byType(ListView), const Offset(0, 1200));
    await tester.pump(const Duration(milliseconds: 500));
    await tester.tapOn(find.widgetWithText(ListTile, 'Lock'));
    await tester.waitFor(find.widgetWithText(TextField, 'Master passphrase'));
    expect(crypto.state.accountUnlocked, false);
  });
}
