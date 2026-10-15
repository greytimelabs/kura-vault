import 'package:flutter/material.dart';

/// The Kura Vault logo mark: a storehouse with a keyhole door. Geometry from
/// branding/tools/mark.mjs; keep the two in step.
class KuraMark extends StatelessWidget {
  final double size;

  /// Defaults to the surrounding icon colour.
  final Color? color;

  const KuraMark({super.key, this.size = 24, this.color});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      excludeSemantics: true,
      child: CustomPaint(
        size: Size.square(size),
        painter: _KuraMarkPainter(color ?? IconTheme.of(context).color ?? Colors.black),
      ),
    );
  }
}

/// The mark on a rounded tile in the primary colour, as the sign-in screens
/// show it.
class KuraBadge extends StatelessWidget {
  final double size;

  const KuraBadge({super.key, this.size = 56});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Centred so a stretched column doesn't widen the tile
    return Center(
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: scheme.primary,
          borderRadius: BorderRadius.circular(size * 0.28),
        ),
        child: KuraMark(size: size * 0.5625, color: scheme.onPrimary),
      ),
    );
  }
}

class _KuraMarkPainter extends CustomPainter {
  final Color color;

  _KuraMarkPainter(this.color);

  // The mark is drawn on a 1024 grid and framed by the square 164..860.
  static const _origin = 164.0;
  static const _extent = 696.0;

  static final Path _roof = Path()
    ..moveTo(484, 200)
    ..lineTo(540, 200)
    ..quadraticBezierTo(616, 318, 836, 362)
    ..lineTo(836, 418)
    ..lineTo(188, 418)
    ..lineTo(188, 362)
    ..quadraticBezierTo(408, 318, 484, 200)
    ..close();

  static final Path _bodyWithDoor = Path()
    ..fillType = PathFillType.evenOdd
    ..addRect(const Rect.fromLTRB(264, 446, 760, 824))
    ..moveTo(484, 663.5)
    ..arcToPoint(const Offset(540, 663.5), radius: const Radius.circular(72), largeArc: true)
    ..lineTo(568, 764)
    ..lineTo(456, 764)
    ..close();

  @override
  void paint(Canvas canvas, Size size) {
    final scale = size.shortestSide / _extent;
    canvas
      ..translate((size.width - _extent * scale) / 2, (size.height - _extent * scale) / 2)
      ..scale(scale)
      ..translate(-_origin, -_origin);
    final paint = Paint()..color = color;
    canvas
      ..drawPath(_roof, paint)
      ..drawPath(_bodyWithDoor, paint);
  }

  @override
  bool shouldRepaint(_KuraMarkPainter old) => old.color != color;
}
