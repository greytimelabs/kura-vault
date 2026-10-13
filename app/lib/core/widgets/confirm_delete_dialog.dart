import 'package:flutter/material.dart';
import '../network/api_error.dart';

/// The last question before something is erased for good. Stays open and shows
/// the reason when the deletion is refused.
class ConfirmDeleteDialog extends StatefulWidget {
  final String title;

  /// What will happen, one paragraph each.
  final List<String> body;
  final String confirmLabel;

  /// Something the user must type first: a name to repeat, or a passphrase.
  final String? inputLabel;
  final bool secret;

  /// When set, the button stays disabled until exactly this is typed.
  final String? expected;

  /// Throw a [StateError] to show its message and keep the dialog open.
  final Future<void> Function(String value) onConfirm;

  const ConfirmDeleteDialog({
    super.key,
    required this.title,
    required this.body,
    required this.confirmLabel,
    required this.onConfirm,
    this.inputLabel,
    this.secret = false,
    this.expected,
  });

  /// True when the deletion went through.
  static Future<bool> show(
    BuildContext context, {
    required String title,
    required List<String> body,
    required String confirmLabel,
    required Future<void> Function(String value) onConfirm,
    String? inputLabel,
    bool secret = false,
    String? expected,
  }) async {
    final done = await showDialog<bool>(
      context: context,
      builder: (_) => ConfirmDeleteDialog(
        title: title,
        body: body,
        confirmLabel: confirmLabel,
        onConfirm: onConfirm,
        inputLabel: inputLabel,
        secret: secret,
        expected: expected,
      ),
    );
    return done ?? false;
  }

  @override
  State<ConfirmDeleteDialog> createState() => _ConfirmDeleteDialogState();
}

class _ConfirmDeleteDialogState extends State<ConfirmDeleteDialog> {
  final _controller = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _controller.clear();
    _controller.dispose();
    super.dispose();
  }

  bool get _ready {
    if (widget.inputLabel == null) return true;
    final expected = widget.expected;
    return expected != null
        ? _controller.text == expected
        : _controller.text.isNotEmpty;
  }

  Future<void> _submit() async {
    if (!_ready || _busy) return;
    final value = _controller.text;
    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    // A passphrase leaves the field before the slow work starts
    if (widget.secret) _controller.clear();
    try {
      await widget.onConfirm(value);
      navigator.pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _busy = false;
        _error = apiErrorMessage(e, 'Something went wrong');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return PopScope(
      canPop: !_busy,
      child: AlertDialog(
        title: Text(widget.title),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final paragraph in widget.body)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Text(paragraph),
                ),
              if (widget.inputLabel != null)
                TextField(
                  controller: _controller,
                  obscureText: widget.secret,
                  enableSuggestions: false,
                  autocorrect: false,
                  autofocus: true,
                  // Read-only rather than disabled while working: the field keeps
                  // its focus, so a wrong passphrase can be typed again at once
                  readOnly: _busy,
                  decoration: InputDecoration(
                    labelText: widget.inputLabel,
                    border: const OutlineInputBorder(),
                  ),
                  onChanged: (_) => setState(() {}),
                  onSubmitted: (_) => _submit(),
                ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(_error!, style: TextStyle(color: scheme.error)),
                ),
            ],
          ),
        ),
        actions: [
          TextButton(
            onPressed: _busy ? null : () => Navigator.of(context).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: _ready && !_busy ? _submit : null,
            style: TextButton.styleFrom(foregroundColor: scheme.error),
            child: _busy
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(widget.confirmLabel),
          ),
        ],
      ),
    );
  }
}
