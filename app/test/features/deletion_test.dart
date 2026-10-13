import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/blocs/media/media_cubit.dart';
import 'package:kura_vault/core/widgets/confirm_delete_dialog.dart';
import '../support/fake_network.dart';

/// A server holding one vault's items, answering the list and delete calls.
class _FakeVault {
  final List<String> ids;
  int? failDeleteCall;
  int deleteCalls = 0;

  _FakeVault(int count) : ids = [for (var i = 0; i < count; i++) 'item-${i.toString().padLeft(3, '0')}'];

  FakeNetwork get network => FakeNetwork()
    ..handler = (o) {
      if (o.method == 'POST' && o.uri.path.endsWith('/media/delete')) {
        if (++deleteCalls == failDeleteCall) {
          return FakeNetwork.json(403, {'message': 'Write access to the vault required'});
        }
        final gone = ((o.data as Map)['ids'] as List).cast<String>();
        ids.removeWhere(gone.contains);
        return FakeNetwork.json(200, {'data': {'deleted': gone.length}});
      }
      final page = int.parse(o.uri.queryParameters['page']!);
      final limit = int.parse(o.uri.queryParameters['limit']!);
      return FakeNetwork.json(200, {
        'data': {
          'data': [
            for (final id in ids.skip((page - 1) * limit).take(limit))
              {'id': id, 'vaultId': 'v1', 'mediaType': 'photo', 'thumbIv': 'aXY=', 'thumbUrl': 'https://s/$id'},
          ],
          'total': ids.length,
          'page': page,
          'totalPages': (ids.length / limit).ceil(),
        },
      });
    };
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('MediaCubit.deleteItems', () {
    test('takes the items out and pulls up what moved into the gap', () async {
      final server = _FakeVault(120);
      final network = server.network;
      final media = MediaCubit(apiClient: await signedInClient(network));
      await media.loadMedia(vaultId: 'v1');
      await media.loadNext();
      expect(media.state.items, hasLength(100));

      await media.deleteItems(['item-002', 'item-060', 'item-099']);

      expect((network.sent('POST', '/media/delete').single.data as Map)['ids'],
          ['item-002', 'item-060', 'item-099']);
      // Exactly what the server now has in its first two pages, in order
      expect(media.state.items.map((m) => m.id), server.ids.take(100));
      expect(media.state.total, 117);

      // The next page continues without skipping or repeating anything
      await media.loadNext();
      expect(media.state.items.map((m) => m.id), server.ids);
      expect(media.state.hasMore, isFalse);
    });

    test('deleting everything that is left leaves an empty list', () async {
      final server = _FakeVault(3);
      final media = MediaCubit(apiClient: await signedInClient(server.network));
      await media.loadMedia(vaultId: 'v1');
      await media.deleteItems([...server.ids]);
      expect(media.state.items, isEmpty);
      expect(media.state.total, 0);
    });

    test('a large selection goes in batches the server accepts', () async {
      final server = _FakeVault(250);
      final network = server.network;
      final media = MediaCubit(apiClient: await signedInClient(network));
      await media.loadMedia(vaultId: 'v1');

      await media.deleteItems(server.ids.take(150).toList());

      final sizes = network.sent('POST', '/media/delete').map((r) => ((r.data as Map)['ids'] as List).length);
      expect(sizes, [MediaCubit.deleteBatch, 50]);
      expect(media.state.total, 100);
    });

    test('a refusal is reported, and what was already deleted is gone from the list', () async {
      final server = _FakeVault(250)..failDeleteCall = 2;
      final media = MediaCubit(apiClient: await signedInClient(server.network));
      await media.loadMedia(vaultId: 'v1');
      final wanted = server.ids.take(150).toList();

      await expectLater(media.deleteItems(wanted), throwsA(anything));

      expect(server.ids, hasLength(150));
      expect(media.state.items.map((m) => m.id), server.ids.take(50));
    });

    test('a refusal of the only request changes nothing', () async {
      final server = _FakeVault(10)..failDeleteCall = 1;
      final media = MediaCubit(apiClient: await signedInClient(server.network));
      await media.loadMedia(vaultId: 'v1');
      await expectLater(media.deleteItems(['item-001']), throwsA(anything));
      expect(media.state.items, hasLength(10));
    });
  });

  group('ConfirmDeleteDialog', () {
    Future<void> open(
      WidgetTester tester, {
      required Future<void> Function(String) onConfirm,
      String? expected,
      bool secret = false,
    }) async {
      await tester.pumpWidget(MaterialApp(
        home: Builder(
          builder: (context) => TextButton(
            onPressed: () => ConfirmDeleteDialog.show(
              context,
              title: 'Delete it?',
              body: const ['This cannot be undone.'],
              confirmLabel: 'Delete now',
              inputLabel: 'Confirm',
              expected: expected,
              secret: secret,
              onConfirm: onConfirm,
            ),
            child: const Text('open'),
          ),
        ),
      ));
      await tester.tap(find.text('open'));
      await tester.pumpAndSettle();
    }

    TextButton confirmButton(WidgetTester tester) =>
        tester.widget<TextButton>(find.widgetWithText(TextButton, 'Delete now'));

    testWidgets('stays disabled until exactly the expected text is typed', (tester) async {
      var confirmed = 0;
      await open(tester, expected: 'mira.k', onConfirm: (_) async => confirmed++);
      expect(confirmButton(tester).onPressed, isNull);

      await tester.enterText(find.byType(TextField), 'mira');
      await tester.pump();
      expect(confirmButton(tester).onPressed, isNull);

      await tester.enterText(find.byType(TextField), 'mira.k');
      await tester.pump();
      await tester.tap(find.text('Delete now'));
      await tester.pumpAndSettle();
      expect(confirmed, 1);
      expect(find.text('Delete it?'), findsNothing);
    });

    testWidgets('a wrong passphrase keeps the dialog open, says so, and empties the field', (tester) async {
      final tried = <String>[];
      await open(tester, secret: true, onConfirm: (value) async {
        tried.add(value);
        if (value != 'right one') throw StateError('Wrong passphrase');
      });

      await tester.enterText(find.byType(TextField), 'wrong one');
      await tester.pump();
      await tester.tap(find.text('Delete now'));
      await tester.pumpAndSettle();
      expect(find.text('Wrong passphrase'), findsOneWidget);
      expect(find.text('Delete it?'), findsOneWidget);
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);
      expect(tester.widget<TextField>(find.byType(TextField)).obscureText, isTrue);

      await tester.enterText(find.byType(TextField), 'right one');
      await tester.pump();
      await tester.tap(find.text('Delete now'));
      await tester.pumpAndSettle();
      expect(tried, ['wrong one', 'right one']);
      expect(find.text('Delete it?'), findsNothing);
    });

    testWidgets('cancel deletes nothing', (tester) async {
      var confirmed = 0;
      await open(tester, onConfirm: (_) async => confirmed++);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(confirmed, 0);
      expect(find.text('Delete it?'), findsNothing);
    });
  });
}
