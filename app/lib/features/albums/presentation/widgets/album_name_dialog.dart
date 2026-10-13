import 'package:flutter/material.dart';
import '../../../../core/network/api_error.dart';

/// Name prompt shared by "New album" and "Rename". Closes itself once
/// [onSubmit] has finished; returns true when it did.
class AlbumNameDialog extends StatefulWidget {
  final String title;
  final String submitLabel;
  final String initialName;
  final Future<void> Function(String name) onSubmit;

  const AlbumNameDialog({
    super.key,
    required this.title,
    required this.submitLabel,
    this.initialName = '',
    required this.onSubmit,
  });

  static const int maxNameLength = 100;

  static Future<bool> show(
    BuildContext context, {
    required String title,
    required String submitLabel,
    String initialName = '',
    required Future<void> Function(String name) onSubmit,
  }) async {
    final done = await showDialog<bool>(
      context: context,
      builder: (_) => AlbumNameDialog(
        title: title,
        submitLabel: submitLabel,
        initialName: initialName,
        onSubmit: onSubmit,
      ),
    );
    return done ?? false;
  }

  @override
  State<AlbumNameDialog> createState() => _AlbumNameDialogState();
}

class _AlbumNameDialogState extends State<AlbumNameDialog> {
  late final _name = TextEditingController(text: widget.initialName);
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final name = _name.text.trim();
    if (name.isEmpty) {
      setState(() => _error = 'Enter a name');
      return;
    }
    if (_busy) return;
    final navigator = Navigator.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await widget.onSubmit(name);
      if (mounted) navigator.pop(true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = apiErrorMessage(e, 'Could not save the album');
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.title),
      scrollable: true,
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text('Album names are encrypted; the server cannot read them.'),
          const SizedBox(height: 16),
          TextField(
            controller: _name,
            enabled: !_busy,
            autofocus: true,
            maxLength: AlbumNameDialog.maxNameLength,
            textCapitalization: TextCapitalization.sentences,
            onSubmitted: (_) => _submit(),
            decoration: InputDecoration(
              labelText: 'Album name',
              errorText: _error,
              errorMaxLines: 3,
              border: const OutlineInputBorder(),
            ),
          ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: _busy
              ? const SizedBox(
                  height: 18,
                  width: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : Text(widget.submitLabel),
        ),
      ],
    );
  }
}
