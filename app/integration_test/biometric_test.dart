// Fingerprint / face unlock on a device or simulator with biometrics
// enrolled, against the interop stack (see interop_test.dart for starting it).
//
// The system prompt cannot be answered from inside a test. Keep a match
// arriving from outside while this runs:
//   iOS simulator (after Features > Face ID > Enrolled):
//     while true; do xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit_Sim.pearl.match; sleep 1; done
//   Android emulator (after setting a PIN and enrolling finger 1 in Settings).
//   Touch only once the prompt is showing: a touch that lands before it does
//   is reported as a match by the emulator but does not authorise the key.
//     while true; do
//       if adb shell dumpsys window windows | grep -q BiometricPrompt; then
//         sleep 1.5; adb -e emu finger touch 1; sleep 3
//       fi; sleep 0.5
//     done
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:kura_vault/app.dart';
import 'package:kura_vault/blocs/auth/auth_cubit.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/core/platform/biometric_channel.dart';
import 'package:kura_vault/core/security/biometric_unlock.dart';
import 'package:shared_preferences/shared_preferences.dart';

const server = 'http://localhost:3100';
const ownerName = 'e2e-owner';
const ownerPassword = 'Owner-Passw0rd!-e2e';
const ownerPassphrase = 'owner master passphrase for e2e';
const webVaultPassphrase = 'made on the web passphrase';

extension on WidgetTester {
  Future<void> waitFor(Finder finder, {Duration timeout = const Duration(seconds: 40)}) async {
    final end = DateTime.now().add(timeout);
    while (finder.evaluate().isEmpty) {
      if (DateTime.now().isAfter(end)) {
        final shown = find.byType(Text).evaluate().map((e) => (e.widget as Text).data).nonNulls.join(' | ');
        fail('Timed out waiting for $finder. On screen: $shown');
      }
      await pump(const Duration(milliseconds: 100));
    }
    await pump(const Duration(milliseconds: 300));
  }

  Future<void> tapOn(Finder finder) async {
    await waitFor(finder);
    await ensureVisible(finder.first);
    await pump(const Duration(milliseconds: 200));
    await tap(finder.first);
    await pump(const Duration(milliseconds: 400));
  }

  Future<void> type(String field, String text) async {
    final finder = find.widgetWithText(TextField, field);
    await waitFor(finder);
    await enterText(finder.last, text);
    await pump(const Duration(milliseconds: 100));
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('a fingerprint or face unlocks the account once it is switched on', (tester) async {
    await const FlutterSecureStorage().deleteAll();
    await const FlutterSecureStorage(
      iOptions: IOSOptions(accessibility: KeychainAccessibility.unlocked_this_device),
    ).deleteAll();
    await (await SharedPreferences.getInstance()).clear();

    expect(await const BiometricChannel().status(), BiometricStatus.available,
        reason: 'enrol a fingerprint or face on this device first');

    await tester.pumpWidget(const KuraVaultApp());

    // ── Sign in, unlock with the passphrase, open a vault ──
    await tester.type('Server URL', server);
    await tester.tapOn(find.text('Connect'));
    // A plain-http server on this machine: the app warns first
    await tester.waitFor(find.text('Login').evaluate().isEmpty ? find.text('Continue') : find.text('Login'));
    if (find.text('Continue').evaluate().isNotEmpty) await tester.tapOn(find.text('Continue'));
    await tester.type('Username', ownerName);
    await tester.type('Password', ownerPassword);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Login'));
    await tester.type('Master passphrase', ownerPassphrase);
    // Off by default: nothing about fingerprints on the unlock screen
    expect(find.text('Use fingerprint or face'), findsNothing);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Unlock'));
    await tester.waitFor(find.text('Open a vault'));
    await tester.type('Vault passphrase', webVaultPassphrase);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Open'));
    await tester.waitFor(find.text('Web vault'));

    final context = tester.element(find.text('Web vault'));
    final biometrics = context.read<BiometricUnlock>();
    final auth = context.read<AuthCubit>();
    final crypto = context.read<VaultCryptoCubit>();
    final accountId = auth.state.active!.id;
    expect(await biometrics.isEnabled(accountId), isFalse);

    // ── Switch it on: the master passphrase, then one check ──
    await tester.tapOn(find.byTooltip('More'));
    await tester.tapOn(find.text('Settings'));
    final toggle = find.widgetWithText(SwitchListTile, 'Unlock with fingerprint or face');
    await tester.waitFor(toggle);
    expect(tester.widget<SwitchListTile>(toggle).value, isFalse);

    await tester.tapOn(toggle);
    await tester.type('Master passphrase', 'not the master passphrase');
    await tester.tapOn(find.text('Continue'));
    await tester.waitFor(find.text('Invalid passphrase'));
    expect(await biometrics.isEnabled(accountId), isFalse);

    await tester.tapOn(toggle);
    await tester.type('Master passphrase', ownerPassphrase);
    await tester.tapOn(find.text('Continue'));
    // The system asks for a face or finger here
    await tester.waitFor(find.text('Fingerprint or face unlock is on'), timeout: const Duration(seconds: 60));
    expect(tester.widget<SwitchListTile>(toggle).value, isTrue);
    expect(await biometrics.offerFor(accountId), BiometricOffer.ready);

    // ── Lock: the next unlock needs no typing ──
    crypto.lock();
    await tester.waitFor(find.text('Use fingerprint or face'));
    // The screen asked by itself; the match arrives from outside
    await tester.waitFor(find.text('Open a vault'), timeout: const Duration(seconds: 60));
    expect(crypto.state.accountUnlocked, isTrue);
    // Vault passphrases are still typed: nothing is open yet
    expect(crypto.state.isUnlocked, isFalse);

    // ── Switching it off destroys the stored key ──
    await tester.type('Vault passphrase', webVaultPassphrase);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Open'));
    await tester.waitFor(find.text('Web vault'));
    await tester.tapOn(find.byTooltip('More'));
    await tester.tapOn(find.text('Settings'));
    await tester.tapOn(toggle);
    await tester.pump(const Duration(seconds: 1));
    expect(tester.widget<SwitchListTile>(toggle).value, isFalse);
    expect(await const BiometricChannel().has(accountId), isFalse);
    crypto.lock();
    await tester.waitFor(find.widgetWithText(TextField, 'Master passphrase'));
    await tester.pump(const Duration(seconds: 2));
    expect(find.text('Use fingerprint or face'), findsNothing);
    expect(crypto.state.accountUnlocked, isFalse);

    // ── On again, then signing out switches it off too ──
    await tester.type('Master passphrase', ownerPassphrase);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Unlock'));
    await tester.waitFor(find.text('Open a vault'));
    await tester.type('Vault passphrase', webVaultPassphrase);
    await tester.tapOn(find.widgetWithText(ElevatedButton, 'Open'));
    await tester.waitFor(find.text('Web vault'));
    await tester.tapOn(find.byTooltip('More'));
    await tester.tapOn(find.text('Settings'));
    await tester.tapOn(toggle);
    await tester.type('Master passphrase', ownerPassphrase);
    await tester.tapOn(find.text('Continue'));
    await tester.waitFor(find.text('Fingerprint or face unlock is on'), timeout: const Duration(seconds: 60));
    expect(await const BiometricChannel().has(accountId), isTrue);

    await auth.signOut(accountId);
    await tester.waitFor(find.widgetWithText(ElevatedButton, 'Login'));
    await tester.pump(const Duration(seconds: 1));
    expect(await biometrics.isEnabled(accountId), isFalse);
    expect(await const BiometricChannel().has(accountId), isFalse);
  });
}
