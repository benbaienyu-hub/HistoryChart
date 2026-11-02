import 'dart:io' show File;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../logic/task_parser.dart';
import '../models/task.dart';
import 'app_scope.dart';
import 'task_fields.dart';

/// Step 4 of the user flow: confirm or fix what the app understood.
///
/// Anything the parser had to guess is outlined in red, and the source —
/// the photo or the transcript — sits at the top so a wrong date can be
/// checked against where it came from (plan §14).
class DraftReviewScreen extends StatefulWidget {
  const DraftReviewScreen({
    super.key,
    required this.drafts,
    required this.sourceText,
    required this.source,
    this.imagePath,
  });

  final List<TaskDraft> drafts;
  final String sourceText;
  final TaskSource source;
  final String? imagePath;

  @override
  State<DraftReviewScreen> createState() => _DraftReviewScreenState();
}

class _DraftReviewScreenState extends State<DraftReviewScreen> {
  late final List<TaskDraft> _drafts = [...widget.drafts];
  bool _saved = false;

  @override
  void dispose() {
    // Backing out without saving should not leave a homework photo behind
    // on the phone that no task points to.
    if (!_saved && widget.imagePath != null && !kIsWeb) {
      try {
        File(widget.imagePath!).deleteSync();
      } catch (_) {}
    }
    super.dispose();
  }

  void _addBlank() {
    final now = AppScope.read(context).clock();
    final d = parseLine('New task', now: now, source: widget.source)!;
    d.task.sourceImagePath = widget.imagePath;
    setState(() => _drafts.add(d));
  }

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final anyGuess =
        _drafts.any((d) => d.dueGuessed || d.subjectGuessed || d.minutesGuessed);

    return Scaffold(
      appBar: AppBar(title: Text('Check ${_drafts.length} task(s)')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 120),
        children: [
          ExpansionTile(
            tilePadding: EdgeInsets.zero,
            title: Text(switch (widget.source) {
              TaskSource.photo => 'What the camera read',
              TaskSource.voice => 'What you said',
              TaskSource.text => 'What you typed',
            }),
            initiallyExpanded: widget.imagePath != null,
            children: [
              if (widget.imagePath != null && !kIsWeb)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.file(File(widget.imagePath!),
                      height: 220, fit: BoxFit.contain),
                ),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: SelectableText(widget.sourceText),
              ),
            ],
          ),
          if (anyGuess)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                  'Boxes outlined in red were guessed. Please check them.',
                  style: TextStyle(color: s.error)),
            ),
          if (_drafts.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Text('No tasks found. Add one by hand below.'),
            ),
          for (final d in _drafts)
            Padding(
              key: ObjectKey(d),
              padding: const EdgeInsets.only(bottom: 12),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(children: [
                        Expanded(
                          child: Text(d.task.sourceText ?? '',
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: Theme.of(context).textTheme.bodySmall),
                        ),
                        IconButton(
                          tooltip: 'Remove',
                          icon: const Icon(Icons.close),
                          onPressed: () => setState(() => _drafts.remove(d)),
                        ),
                      ]),
                      TaskFields(
                        task: d.task,
                        onChanged: () => setState(() {}),
                        flagDue: d.dueGuessed,
                        flagMinutes: d.minutesGuessed,
                        flagSubject: d.subjectGuessed,
                      ),
                    ],
                  ),
                ),
              ),
            ),
          OutlinedButton.icon(
            onPressed: _addBlank,
            icon: const Icon(Icons.add),
            label: const Text('Add another task'),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: FilledButton(
            onPressed: _drafts.isEmpty
                ? null
                : () {
                    _saved = true;
                    AppScope.read(context)
                        .addTasks([for (final d in _drafts) d.task]);
                    Navigator.pop(context);
                  },
            child: Text('Add ${_drafts.length} to my plan'),
          ),
        ),
      ),
    );
  }
}
