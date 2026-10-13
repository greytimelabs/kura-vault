import 'package:intl/intl.dart';

/// `1:05`, or `1:02:03` from an hour up.
String formatDuration(int totalSeconds) {
  final seconds = totalSeconds < 0 ? 0 : totalSeconds;
  final h = seconds ~/ 3600;
  final m = (seconds % 3600) ~/ 60;
  final s = (seconds % 60).toString().padLeft(2, '0');
  return h > 0 ? '$h:${m.toString().padLeft(2, '0')}:$s' : '$m:$s';
}

/// A capture time for display, in this device's time zone. Null when there is
/// none or it cannot be read.
String? formatDateTime(String? iso) {
  if (iso == null) return null;
  final date = DateTime.tryParse(iso);
  return date == null ? null : DateFormat.yMMMd().add_jm().format(date.toLocal());
}
