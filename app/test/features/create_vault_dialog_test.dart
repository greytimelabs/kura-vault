import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/crypto/vault_crypto_cubit.dart';
import 'package:kura_vault/blocs/vault/vault_cubit.dart';
import 'package:kura_vault/features/auth/presentation/widgets/create_vault_dialog.dart';
import '../support/fake_network.dart';

void main() {
  testWidgets('a short or mismatched passphrase is refused before anything is sent', (tester) async {
    final network = FakeNetwork();
    final client = await tester.runAsync(() => signedInClient(network));

    await tester.pumpWidget(MultiBlocProvider(
      providers: [
        BlocProvider(create: (_) => VaultCryptoCubit()),
        BlocProvider(create: (_) => VaultCubit(apiClient: client!)),
      ],
      child: MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => CreateVaultDialog.show(context),
            child: const Text('open'),
          ),
        ),
      ),
    ));
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    final passphrase = find.widgetWithText(TextField, 'Passphrase');
    final confirm = find.widgetWithText(TextField, 'Confirm passphrase');

    // Nothing is flagged until the first attempt
    await tester.enterText(passphrase, 'short');
    await tester.pump();
    expect(find.text('Use at least 12 characters'), findsNothing);

    await tester.tap(find.text('Create vault'));
    await tester.pump();
    expect(find.text('Use at least 12 characters'), findsOneWidget);

    await tester.enterText(passphrase, 'long enough passphrase');
    await tester.enterText(confirm, 'something else entirely');
    await tester.tap(find.text('Create vault'));
    await tester.pump();
    expect(find.text('Passphrases do not match'), findsOneWidget);
    expect(network.requests, isEmpty);

    // Both fields hide what is typed
    expect(tester.widget<TextField>(passphrase).obscureText, true);
    expect(tester.widget<TextField>(confirm).obscureText, true);

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    expect(find.text('Create a vault'), findsNothing);
  });
}
