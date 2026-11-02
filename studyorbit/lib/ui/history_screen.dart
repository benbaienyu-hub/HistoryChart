import 'package:flutter/material.dart';

import '../logic/dates.dart';
import 'app_scope.dart';

/// What changed and how much got done (plan §2 历史记录).
class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final now = state.clock();
    final weekStart = dayOf(now).subtract(Duration(days: now.weekday - 1));
    final minutes = state.minutesStudiedSince(weekStart);
    final done = state.tasksCompletedSince(weekStart);
    final text = Theme.of(context).textTheme;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        Row(children: [
          Expanded(child: _Stat('${minutes ~/ 60}h ${minutes % 60}m', 'studied this week')),
          const SizedBox(width: 12),
          Expanded(child: _Stat('$done', 'tasks done this week')),
        ]),
        const SizedBox(height: 16),
        if (state.history.isEmpty)
          const Text('Nothing yet. Everything you add, finish or postpone '
              'shows up here.'),
        for (final h in state.history.take(300))
          ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            title: Text('${h.action} · ${h.detail}'),
            subtitle: Text('${shortDate(h.at, today: now)} ${clock(h.at)}',
                style: text.bodySmall),
          ),
      ],
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat(this.value, this.label);
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(value, style: Theme.of(context).textTheme.headlineSmall),
              Text(label),
            ],
          ),
        ),
      );
}
