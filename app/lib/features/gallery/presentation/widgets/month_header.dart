import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

class MonthHeader extends StatelessWidget {
  final String yearMonth; // e.g. '2024-03'

  const MonthHeader({super.key, required this.yearMonth});

  @override
  Widget build(BuildContext context) {
    final parts = yearMonth.split('-');
    final date = DateTime(int.parse(parts[0]), int.parse(parts[1]));
    final formatted = DateFormat.yMMMM().format(date);

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
      child: Text(
        formatted,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.bold,
            ),
      ),
    );
  }
}
