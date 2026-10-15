import 'package:flutter/material.dart';

/// Brand colours, as listed in branding/README.md.
class KuraColors {
  KuraColors._();

  /// Indigo dye (藍染). Primary.
  static const aizome = Color(0xFF233A5E);

  /// Lime-plastered walls. The mark on indigo.
  static const plaster = Color(0xFFF2ECE1);

  static const ink = Color(0xFF141A24);

  /// Accent on dark backgrounds.
  static const aizomeLight = Color(0xFF9FB4D6);
}

/// Material theme seeded from the brand indigo. The fidelity variant keeps the
/// primary colour close to the seed instead of drifting to a generic blue.
ThemeData kuraTheme(Brightness brightness) {
  return ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: KuraColors.aizome,
      brightness: brightness,
      dynamicSchemeVariant: DynamicSchemeVariant.fidelity,
    ),
  );
}
