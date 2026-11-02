import 'package:flutter/material.dart';

import '../logic/dates.dart';
import '../logic/prioritizer.dart';
import '../models/task.dart';
import 'app_scope.dart';
import 'task_edit_screen.dart';

/// Every task, in the order the planner would do them, with the reasons
/// shown — so the student can see *why* something is first and disagree.
class TasksScreen extends StatelessWidget {
  const TasksScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final now = state.clock();
    final ranked = rankTasks(state.tasks, now: now, settings: state.settings);
    final rankedIds = {for (final t in ranked) t.id};
    final postponed = state.tasks
        .where((t) => t.isOpen && !rankedIds.contains(t.id))
        .toList()
      ..sort((a, b) => a.due.compareTo(b.due));
    final done = state.tasks.where((t) => !t.isOpen).toList()
      ..sort((a, b) => (b.completedAt ?? b.createdAt)
          .compareTo(a.completedAt ?? a.createdAt));

    if (state.tasks.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Text(
              'No tasks yet.\nTap Add to take a photo, say, or type '
              "today's homework.",
              textAlign: TextAlign.center),
        ),
      );
    }

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 8, 12, 96),
      children: [
        for (final t in ranked) _TaskTile(task: t, now: now),
        if (postponed.isNotEmpty) ...[
          const _Header('Postponed'),
          for (final t in postponed) _TaskTile(task: t, now: now),
        ],
        if (done.isNotEmpty) ...[
          const _Header('Done'),
          for (final t in done.take(30)) _TaskTile(task: t, now: now),
        ],
      ],
    );
  }
}

class _Header extends StatelessWidget {
  const _Header(this.text);
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 16, 4, 6),
        child: Text(text, style: Theme.of(context).textTheme.titleSmall),
      );
}

class _TaskTile extends StatelessWidget {
  const _TaskTile({required this.task, required this.now});
  final Task task;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final state = AppScope.read(context);
    final s = Theme.of(context).colorScheme;
    final p = scoreTask(task, now: now, settings: state.settings);
    final overdue = task.isOpen && daysBetween(now, task.due) < 0;
    final stepsDone = task.steps.where((x) => x.done).length;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Card(
        child: ListTile(
          onTap: () => Navigator.of(context).push(
              MaterialPageRoute(builder: (_) => TaskEditScreen(task: task))),
          leading: Checkbox(
            value: !task.isOpen,
            onChanged: (v) => state.setDone(task, v ?? false),
          ),
          title: Text(task.title,
              style: TextStyle(
                  decoration: task.isOpen ? null : TextDecoration.lineThrough)),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${task.subject} · ${task.type.label} · '
                'due ${shortDate(task.due, today: now)} · '
                '${task.remainingMinutes} min'
                '${task.steps.isEmpty ? '' : ' · $stepsDone/${task.steps.length} steps'}',
                style: TextStyle(color: overdue ? s.error : null),
              ),
              if (task.isOpen && p.reasons.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Wrap(spacing: 4, runSpacing: 4, children: [
                    for (final r in p.reasons)
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 6, vertical: 1),
                        decoration: BoxDecoration(
                          color: s.secondaryContainer,
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: Text(r,
                            style: TextStyle(
                                fontSize: 11, color: s.onSecondaryContainer)),
                      ),
                  ]),
                ),
            ],
          ),
          trailing: task.locked ? const Icon(Icons.lock, size: 18) : null,
        ),
      ),
    );
  }
}
