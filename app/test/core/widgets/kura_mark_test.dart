import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:kura_vault/core/theme/brand.dart';
import 'package:kura_vault/core/widgets/kura_mark.dart';

void main() {
  for (final brightness in Brightness.values) {
    testWidgets('KuraBadge draws the mark on the primary colour ($brightness)', (tester) async {
      final theme = kuraTheme(brightness);
      await tester.pumpWidget(
        MaterialApp(
          theme: theme,
          home: const Scaffold(
            body: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [KuraBadge(size: 64)],
            ),
          ),
        ),
      );

      final tile = tester.widget<Container>(find.descendant(of: find.byType(KuraBadge), matching: find.byType(Container)));
      expect((tile.decoration! as BoxDecoration).color, theme.colorScheme.primary);
      // Stays a square tile inside a stretched column
      expect(tester.getSize(find.byType(Container).first), const Size(64, 64));
      expect(tester.getSize(find.descendant(of: find.byType(KuraMark), matching: find.byType(CustomPaint))), const Size(36, 36));
    });
  }
}
