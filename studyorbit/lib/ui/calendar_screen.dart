import 'package:flutter/material.dart';

import '../logic/dates.dart';
import '../models/task.dart';
import 'app_scope.dart';
import 'task_edit_screen.dart';

/// Month view of deadlines and exams, plus the selected day's classes.
/// Built from a plain grid rather than a calendar package: it only needs to
/// show dots and handle a tap.
class CalendarScreen extends StatefulWidget {
  const CalendarScreen({super.key});

  @override
  State<CalendarScreen> createState() => _CalendarScreenState();
}

class _CalendarScreenState extends State<CalendarScreen> {
  DateTime? _month;
  DateTime? _selected;

  static const _monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'
  ];

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final now = state.clock();
    final month = _month ?? DateTime(now.year, now.month);
    final selected = _selected ?? dayOf(now);
    final s = Theme.of(context).colorScheme;

    final byDay = <DateTime, List<Task>>{};
    for (final t in state.tasks) {
      byDay.putIfAbsent(dayOf(t.due), () => []).add(t);
    }

    final first = DateTime(month.year, month.month, 1);
    final leading = first.weekday - 1; // Monday-first grid
    final daysInMonth = DateTime(month.year, month.month + 1, 0).day;
    final cells = leading + daysInMonth;
    final rows = (cells / 7).ceil();

    final dayTasks = byDay[selected] ?? const <Task>[];
    final classes = state.settings.timetable[selected.weekday] ?? const [];

    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 0, 12, 96),
      children: [
        Row(children: [
          IconButton(
            icon: const Icon(Icons.chevron_left),
            onPressed: () => setState(
                () => _month = DateTime(month.year, month.month - 1)),
          ),
          Expanded(
            child: Text('${_monthNames[month.month - 1]} ${month.year}',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium),
          ),
          IconButton(
            icon: const Icon(Icons.chevron_right),
            onPressed: () => setState(
                () => _month = DateTime(month.year, month.month + 1)),
          ),
        ]),
        Row(children: [
          for (final d in ['M', 'T', 'W', 'T', 'F', 'S', 'S'])
            Expanded(
                child: Text(d,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodySmall)),
        ]),
        const SizedBox(height: 4),
        for (var r = 0; r < rows; r++)
          Row(children: [
            for (var c = 0; c < 7; c++)
              Expanded(
                child: Builder(builder: (context) {
                  final n = r * 7 + c - leading + 1;
                  if (n < 1 || n > daysInMonth) return const SizedBox(height: 48);
                  final day = DateTime(month.year, month.month, n);
                  final items = byDay[day] ?? const <Task>[];
                  final open = items.where((t) => t.isOpen).toList();
                  final hasExam = open.any((t) => t.type == TaskType.exam);
                  final isSel = sameDay(day, selected);
                  final isToday = sameDay(day, now);
                  return InkWell(
                    borderRadius: BorderRadius.circular(8),
                    onTap: () => setState(() => _selected = day),
                    child: Container(
                      height: 48,
                      margin: const EdgeInsets.all(1),
                      decoration: BoxDecoration(
                        color: isSel ? s.primaryContainer : null,
                        border: isToday ? Border.all(color: s.primary) : null,
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Column(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text('$n'),
                          const SizedBox(height: 2),
                          Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              if (hasExam)
                                _Dot(s.error)
                              else if (open.isNotEmpty)
                                _Dot(s.primary),
                              if (open.length > 1) _Dot(s.primary),
                              if (items.isNotEmpty && open.isEmpty)
                                _Dot(s.outline),
                            ],
                          ),
                        ],
                      ),
                    ),
                  );
                }),
              ),
          ]),
        const SizedBox(height: 16),
        Text(
            '${weekdayNames[selected.weekday - 1]}, '
            '${shortDate(selected, today: now)}',
            style: Theme.of(context).textTheme.titleMedium),
        if (classes.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text('Classes: ${classes.join(', ')}'),
          ),
        const SizedBox(height: 8),
        if (dayTasks.isEmpty) const Text('Nothing due.'),
        for (final t in dayTasks)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: Icon(
                t.type == TaskType.exam ? Icons.quiz_outlined : Icons.assignment_outlined,
                color: t.type == TaskType.exam ? s.error : null),
            title: Text(t.title,
                style: TextStyle(
                    decoration: t.isOpen ? null : TextDecoration.lineThrough)),
            subtitle: Text('${t.subject} · ${t.type.label}'),
            onTap: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => TaskEditScreen(task: t))),
          ),
      ],
    );
  }
}

class _Dot extends StatelessWidget {
  const _Dot(this.color);
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        width: 5,
        height: 5,
        margin: const EdgeInsets.symmetric(horizontal: 1),
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      );
}
