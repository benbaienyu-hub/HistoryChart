import 'dart:io' show File;

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../logic/dates.dart';
import '../logic/task_splitter.dart';
import '../models/task.dart';
import 'app_scope.dart';
import 'task_fields.dart';

/// Edit one task: its details, its steps, lock / postpone / delete, and
/// where it came from.
class TaskEditScreen extends StatefulWidget {
  const TaskEditScreen({super.key, required this.task});
  final Task task;

  @override
  State<TaskEditScreen> createState() => _TaskEditScreenState();
}

class _TaskEditScreenState extends State<TaskEditScreen> {
  bool _dirty = false;

  Task get t => widget.task;

  void _saveIfDirty() {
    if (_dirty) AppScope.read(context).updateTask(t);
    _dirty = false;
  }

  Future<void> _editStep(int? index) async {
    final existing = index == null ? null : t.steps[index];
    final title = TextEditingController(text: existing?.title ?? '');
    var minutes = existing?.minutes ?? 20;
    final ok = await showDialog<bool>(
      context: context,
      builder: (d) => StatefulBuilder(
        builder: (d, setD) => AlertDialog(
          title: Text(index == null ? 'Add step' : 'Edit step'),
          content: Column(mainAxisSize: MainAxisSize.min, children: [
            TextField(
                controller: title,
                autofocus: true,
                decoration: const InputDecoration(labelText: 'Step')),
            const SizedBox(height: 8),
            Row(mainAxisAlignment: MainAxisAlignment.center, children: [
              IconButton(
                  onPressed:
                      minutes > 5 ? () => setD(() => minutes -= 5) : null,
                  icon: const Icon(Icons.remove)),
              Text('$minutes min'),
              IconButton(
                  onPressed: () => setD(() => minutes += 5),
                  icon: const Icon(Icons.add)),
            ]),
          ]),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(d, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(d, true),
                child: const Text('Save')),
          ],
        ),
      ),
    );
    if (ok != true || title.text.trim().isEmpty) return;
    setState(() {
      if (existing != null) {
        existing.title = title.text.trim();
        existing.minutes = minutes;
      } else {
        t.steps.add(TaskStep(title: title.text.trim(), minutes: minutes));
      }
      _dirty = true;
    });
    _saveIfDirty();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final text = Theme.of(context).textTheme;
    final now = state.clock();

    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _saveIfDirty();
      },
      child: Scaffold(
        appBar: AppBar(
          title: Text(t.subject),
          actions: [
            IconButton(
              tooltip: t.locked ? 'Unlock' : 'Lock (do this first, always)',
              icon: Icon(t.locked ? Icons.lock : Icons.lock_open),
              onPressed: () => setState(() => state.toggleLock(t)),
            ),
            IconButton(
              tooltip: 'Delete',
              icon: const Icon(Icons.delete_outline),
              onPressed: () async {
                final ok = await showDialog<bool>(
                  context: context,
                  builder: (d) => AlertDialog(
                    title: const Text('Delete this task?'),
                    content: const Text(
                        'The task, its steps and its photo are removed from '
                        'this phone. This cannot be undone.'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(d, false),
                          child: const Text('Cancel')),
                      FilledButton(
                          onPressed: () => Navigator.pop(d, true),
                          child: const Text('Delete')),
                    ],
                  ),
                );
                if (ok == true && context.mounted) {
                  _dirty = false;
                  state.deleteTask(t);
                  Navigator.pop(context);
                }
              },
            ),
          ],
        ),
        body: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            TaskFields(task: t, onChanged: () => setState(() => _dirty = true)),
            const SizedBox(height: 12),
            Row(children: [
              Expanded(
                child: FilledButton.tonalIcon(
                  onPressed: () => setState(() => state.setDone(t, t.isOpen)),
                  icon: Icon(t.isOpen ? Icons.check : Icons.undo),
                  label: Text(t.isOpen ? 'Mark done' : 'Reopen'),
                ),
              ),
              const SizedBox(width: 8),
              if (t.isOpen)
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: () => setState(() => state.postpone(t)),
                    icon: const Icon(Icons.schedule),
                    label: const Text('Postpone a day'),
                  ),
                ),
            ]),
            if (t.deferredUntil != null &&
                dayOf(t.deferredUntil!).isAfter(dayOf(now)))
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                    'Postponed until ${shortDate(t.deferredUntil!, today: now)}. '
                    'Still due ${shortDate(t.due, today: now)}.'),
              ),
            const SizedBox(height: 24),
            Row(children: [
              Expanded(child: Text('Steps', style: text.titleMedium)),
              if (t.steps.isEmpty)
                TextButton.icon(
                  onPressed: () {
                    final steps = suggestSteps(t);
                    if (steps.isEmpty) {
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
                          content: Text(
                              'This task is short enough to do in one go.')));
                      return;
                    }
                    setState(() {
                      t.steps = steps;
                      _dirty = true;
                    });
                    _saveIfDirty();
                  },
                  icon: const Icon(Icons.call_split),
                  label: const Text('Split into steps'),
                ),
              IconButton(
                  tooltip: 'Add step',
                  onPressed: () => _editStep(null),
                  icon: const Icon(Icons.add)),
            ]),
            if (t.steps.isEmpty)
              const Text('Big tasks are easier to start when they are split '
                  'into steps.'),
            for (var i = 0; i < t.steps.length; i++)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: Checkbox(
                  value: t.steps[i].done,
                  onChanged: (v) =>
                      setState(() => state.setStepDone(t, i, v ?? false)),
                ),
                title: Text(t.steps[i].title),
                subtitle: Text('${t.steps[i].minutes} min'),
                onTap: () => _editStep(i),
                trailing: IconButton(
                  icon: const Icon(Icons.close),
                  onPressed: () {
                    setState(() {
                      t.steps.removeAt(i);
                      _dirty = true;
                    });
                    _saveIfDirty();
                  },
                ),
              ),
            const SizedBox(height: 24),
            if (t.minutesSpent > 0)
              Text('Time studied so far: ${t.minutesSpent} min'),
            if (t.sourceText != null || t.sourceImagePath != null) ...[
              const SizedBox(height: 16),
              Text('Where this came from (${t.source.name})',
                  style: text.titleSmall),
              const SizedBox(height: 6),
              if (t.sourceImagePath != null && !kIsWeb)
                ClipRRect(
                  borderRadius: BorderRadius.circular(8),
                  child: Image.file(File(t.sourceImagePath!),
                      height: 200,
                      fit: BoxFit.contain,
                      errorBuilder: (_, _, _) =>
                          const Text('(photo no longer on this phone)')),
                ),
              if (t.sourceText != null) Text(t.sourceText!),
            ],
          ],
        ),
      ),
    );
  }
}
