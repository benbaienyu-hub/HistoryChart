import 'package:flutter/material.dart';

import '../logic/dates.dart';
import '../logic/task_parser.dart';
import '../models/task.dart';

/// The editable fields of one task, used by both the draft review and the
/// task editor so the two can never disagree about what a task contains.
///
/// Edits are written straight into [task]; [onChanged] tells the parent to
/// redraw or save.
class TaskFields extends StatefulWidget {
  const TaskFields({
    super.key,
    required this.task,
    required this.onChanged,
    this.flagDue = false,
    this.flagMinutes = false,
    this.flagSubject = false,
  });

  final Task task;
  final VoidCallback onChanged;
  final bool flagDue;
  final bool flagMinutes;
  final bool flagSubject;

  @override
  State<TaskFields> createState() => _TaskFieldsState();
}

class _TaskFieldsState extends State<TaskFields> {
  late final _title = TextEditingController(text: widget.task.title);

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  void _set(VoidCallback f) {
    setState(f);
    widget.onChanged();
  }

  @override
  Widget build(BuildContext context) {
    final t = widget.task;
    final s = Theme.of(context).colorScheme;
    final subjects = {...knownSubjects, 'General', t.subject}.toList()..sort();

    Widget flag(bool on, Widget child) => on
        ? Container(
            decoration: BoxDecoration(
              border: Border.all(color: s.error, width: 1.5),
              borderRadius: BorderRadius.circular(6),
            ),
            child: child,
          )
        : child;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _title,
          decoration: const InputDecoration(labelText: 'Task'),
          onChanged: (v) => _set(() => t.title = v.trim()),
        ),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(
            child: flag(
              widget.flagSubject,
              DropdownButtonFormField<String>(
                initialValue: t.subject,
                isExpanded: true,
                decoration: const InputDecoration(labelText: 'Subject'),
                items: [
                  for (final x in subjects)
                    DropdownMenuItem(value: x, child: Text(x)),
                ],
                onChanged: (v) => _set(() => t.subject = v ?? t.subject),
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: DropdownButtonFormField<TaskType>(
              initialValue: t.type,
              isExpanded: true,
              decoration: const InputDecoration(labelText: 'Type'),
              items: [
                for (final x in TaskType.values)
                  DropdownMenuItem(value: x, child: Text(x.label)),
              ],
              onChanged: (v) => _set(() => t.type = v ?? t.type),
            ),
          ),
        ]),
        const SizedBox(height: 10),
        Row(children: [
          Expanded(
            child: flag(
              widget.flagDue,
              OutlinedButton.icon(
                icon: const Icon(Icons.event, size: 18),
                label: Text('Due ${shortDate(t.due)}'),
                onPressed: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: t.due,
                    firstDate: DateTime.now().subtract(const Duration(days: 60)),
                    lastDate: DateTime.now().add(const Duration(days: 365)),
                  );
                  if (picked != null) _set(() => t.due = picked);
                },
              ),
            ),
          ),
          const SizedBox(width: 10),
          flag(
            widget.flagMinutes,
            Row(mainAxisSize: MainAxisSize.min, children: [
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: t.estMinutes > 5
                    ? () => _set(() => t.estMinutes -= 5)
                    : null,
                icon: const Icon(Icons.remove),
              ),
              Text('${t.estMinutes} min'),
              IconButton(
                visualDensity: VisualDensity.compact,
                onPressed: () => _set(() => t.estMinutes += 5),
                icon: const Icon(Icons.add),
              ),
            ]),
          ),
        ]),
        const SizedBox(height: 10),
        SegmentedButton<int>(
          segments: const [
            ButtonSegment(value: 1, label: Text('Easy')),
            ButtonSegment(value: 2, label: Text('Normal')),
            ButtonSegment(value: 3, label: Text('Hard')),
          ],
          selected: {t.difficulty},
          onSelectionChanged: (v) => _set(() => t.difficulty = v.first),
        ),
      ],
    );
  }
}
