/// Builds the 4:00–9:00 PM evening plan (plan §1, §2 晚间计划).
///
/// The plan is never stored. It is recomputed from the task list and the
/// clock every time something changes, which is how "re-plan the remaining
/// time" (§3 step 9) works: finish a task early, postpone one, or open the
/// app at 5:40 instead of 4:00, and the evening simply re-flows from now.
/// Storing a plan would mean keeping it in sync with every edit instead.
library;

import '../models/task.dart';
import 'dates.dart';
import 'prioritizer.dart';

enum BlockKind { study, preview, review, rest, dinner, free }

class PlanBlock {
  PlanBlock({
    required this.start,
    required this.end,
    required this.kind,
    required this.title,
    this.subject,
    this.taskId,
    this.stepIndex,
  });

  final DateTime start;
  final DateTime end;
  final BlockKind kind;
  final String title;
  final String? subject;
  final String? taskId;
  final int? stepIndex;

  int get minutes => end.difference(start).inMinutes;
  bool get isWork =>
      kind == BlockKind.study ||
      kind == BlockKind.preview ||
      kind == BlockKind.review;
}

class Leftover {
  Leftover(this.title, this.minutes, this.taskId, {this.urgent = false});
  final String title;
  final int minutes;
  final String? taskId;

  /// Due today or tomorrow (or overdue). Only these deserve a warning —
  /// an essay due next week not fitting tonight is normal.
  final bool urgent;
}

class EveningPlan {
  EveningPlan(this.blocks, this.leftovers, {this.over = false});
  final List<PlanBlock> blocks;

  /// Work that did not fit tonight. Shown, never silently dropped.
  final List<Leftover> leftovers;

  /// True when it is already past 9 PM.
  final bool over;

  int get studyMinutes =>
      blocks.where((b) => b.isWork).fold(0, (a, b) => a + b.minutes);
}

const planStartMinutes = 16 * 60;
const planEndMinutes = 21 * 60;

class _Unit {
  _Unit(this.title, this.minutes, this.kind, this.score,
      {this.subject, this.taskId, this.stepIndex, this.urgent = false});
  final bool urgent;
  final String title;
  int minutes;
  final BlockKind kind;
  final double score;
  final String? subject;
  final String? taskId;
  final int? stepIndex;
  int parts = 0;
}

DateTime _roundUp5(DateTime t) {
  final extra = (5 - t.minute % 5) % 5;
  final r = DateTime(t.year, t.month, t.day, t.hour, t.minute)
      .add(Duration(minutes: extra));
  return (t.second > 0 || t.millisecond > 0) && extra == 0
      ? r.add(const Duration(minutes: 5))
      : r;
}

const _restTitles = [
  'Rest your eyes — look 20 ft away',
  'Stand up, stretch, drink water',
  'Short break — no phone scrolling',
];

/// [freeMinutesAtEnd] protects some leisure before 9 PM. A plan that fills
/// every minute with work is one students stop following (§14 "学生不持续使用").
EveningPlan buildEveningPlan({
  required List<Task> tasks,
  required Settings settings,
  required DateTime now,
  int freeMinutesAtEnd = 30,
}) {
  final day = dayOf(now);
  final windowStart = atMinutes(day, planStartMinutes);
  final windowEnd = atMinutes(day, planEndMinutes);
  final workEnd = windowEnd.subtract(Duration(minutes: freeMinutesAtEnd));
  final dinnerStart = atMinutes(day, settings.dinnerStart);
  final dinnerEnd = dinnerStart.add(Duration(minutes: settings.dinnerMinutes));

  final units = _buildUnits(tasks, settings, now);

  if (!now.isBefore(windowEnd)) {
    return EveningPlan([], [
      for (final u in units) Leftover(u.title, u.minutes, u.taskId, urgent: u.urgent)
    ], over: true);
  }

  var cursor = now.isAfter(windowStart) ? _roundUp5(now) : windowStart;
  final blocks = <PlanBlock>[];
  var restIndex = 0;

  void fillTo(DateTime until) {
    // Everything that is not work: free time, with dinner placed inside it.
    while (cursor.isBefore(until)) {
      if (cursor.isBefore(dinnerStart)) {
        final stop = dinnerStart.isBefore(until) ? dinnerStart : until;
        blocks.add(PlanBlock(
            start: cursor, end: stop, kind: BlockKind.free, title: 'Free time'));
        cursor = stop;
      } else if (cursor.isBefore(dinnerEnd)) {
        final stop = dinnerEnd.isBefore(until) ? dinnerEnd : until;
        blocks.add(PlanBlock(
            start: cursor, end: stop, kind: BlockKind.dinner, title: 'Dinner'));
        cursor = stop;
      } else {
        blocks.add(PlanBlock(
            start: cursor, end: until, kind: BlockKind.free, title: 'Free time'));
        cursor = until;
      }
    }
  }

  while (units.isNotEmpty && cursor.isBefore(workEnd)) {
    if (!cursor.isBefore(dinnerStart) && cursor.isBefore(dinnerEnd)) {
      fillTo(dinnerEnd);
      continue;
    }
    final boundary =
        cursor.isBefore(dinnerStart) && dinnerStart.isBefore(workEnd)
            ? dinnerStart
            : workEnd;
    final available = boundary.difference(cursor).inMinutes;
    // Ten minutes before dinner is not enough to start anything real.
    if (available < 10) {
      if (boundary == workEnd) break;
      fillTo(boundary);
      continue;
    }

    final u = units.first;
    var chunk = [settings.focusMinutes, u.minutes, available]
        .reduce((a, b) => a < b ? a : b);
    // Don't leave a 5-minute stub for after the break; finish it now.
    if (u.minutes - chunk > 0 && u.minutes - chunk <= 5 && u.minutes <= available) {
      chunk = u.minutes;
    }
    u.parts++;
    final end = cursor.add(Duration(minutes: chunk));
    final continued = u.parts > 1 || u.minutes > chunk;
    blocks.add(PlanBlock(
      start: cursor,
      end: end,
      kind: u.kind,
      title: continued ? '${u.title} · part ${u.parts}' : u.title,
      subject: u.subject,
      taskId: u.taskId,
      stepIndex: u.stepIndex,
    ));
    cursor = end;
    u.minutes -= chunk;
    if (u.minutes <= 0) units.removeAt(0);

    final rest = settings.breakMinutes;
    if (units.isNotEmpty &&
        rest > 0 &&
        !cursor.add(Duration(minutes: rest)).isAfter(boundary) &&
        boundary.difference(cursor).inMinutes >= rest + 10) {
      final restEnd = cursor.add(Duration(minutes: rest));
      blocks.add(PlanBlock(
          start: cursor,
          end: restEnd,
          kind: BlockKind.rest,
          title: _restTitles[restIndex++ % _restTitles.length]));
      cursor = restEnd;
    }
  }

  fillTo(windowEnd);

  return EveningPlan(blocks, [
    for (final u in units) Leftover(u.title, u.minutes, u.taskId, urgent: u.urgent),
  ]);
}

List<_Unit> _buildUnits(List<Task> tasks, Settings settings, DateTime now) {
  final day = dayOf(now);
  final units = <_Unit>[];

  for (final t in rankTasks(tasks, now: now, settings: settings)) {
    final score = scoreTask(t, now: now, settings: settings).score;
    final urgent = daysBetween(now, t.due) <= 1;
    final kind = switch (t.type) {
      TaskType.preview => BlockKind.preview,
      TaskType.review || TaskType.exam => BlockKind.review,
      _ => BlockKind.study,
    };
    if (t.steps.isNotEmpty) {
      for (var i = 0; i < t.steps.length; i++) {
        final s = t.steps[i];
        if (s.done) continue;
        units.add(_Unit('${t.title}: ${s.title}', s.minutes, kind, score,
            subject: t.subject, taskId: t.id, stepIndex: i, urgent: urgent));
      }
    } else {
      units.add(_Unit(t.title, t.remainingMinutes, kind, score,
          subject: t.subject, taskId: t.id, urgent: urgent));
    }
  }

  // Preview for tomorrow's classes and review of today's weak-subject classes
  // come from the timetable, so they appear without the student typing them.
  // Skipped when the student already has their own task of that kind.
  bool hasOwn(TaskType type, String subject) => tasks.any((t) =>
      t.isOpen && t.type == type && t.subject == subject);

  final tomorrow = day.add(const Duration(days: 1));
  for (final s in settings.timetable[tomorrow.weekday] ?? const <String>[]) {
    if (hasOwn(TaskType.preview, s)) continue;
    units.add(_Unit('Preview $s for tomorrow', 10, BlockKind.preview, 50,
        subject: s));
  }
  for (final s in settings.timetable[day.weekday] ?? const <String>[]) {
    if (!settings.weakSubjects.contains(s) || hasOwn(TaskType.review, s)) {
      continue;
    }
    units.add(_Unit("Review today's $s class", 15, BlockKind.review, 45,
        subject: s));
  }

  // Stable sort: tasks keep the ranker's tie-breaking order.
  final indexed = units.asMap().entries.toList()
    ..sort((a, b) {
      final c = b.value.score.compareTo(a.value.score);
      return c != 0 ? c : a.key.compareTo(b.key);
    });
  return [for (final e in indexed) e.value];
}

/// The checklist for tomorrow (plan §3 step 10): what to bring, read, and
/// finish before class.
List<String> tomorrowChecklist({
  required List<Task> tasks,
  required Settings settings,
  required DateTime now,
}) {
  final tomorrow = dayOf(now).add(const Duration(days: 1));
  final items = <String>[];
  for (final s in settings.timetable[tomorrow.weekday] ?? const <String>[]) {
    items.add('$s: skim the next lesson and pack materials');
  }
  for (final t in tasks.where((t) => t.isOpen)) {
    final d = daysBetween(now, t.due);
    if (d <= 1) {
      items.add('Hand in: ${t.subject} — ${t.title}');
    } else if (t.type == TaskType.exam && d <= 3) {
      items.add('Exam in $d days: ${t.subject} — ${t.title}');
    }
  }
  return items;
}
