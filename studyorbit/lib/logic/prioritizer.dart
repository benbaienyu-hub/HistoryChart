/// Decides what to work on first, and says why.
///
/// The plan (§1) names the inputs: deadline, estimated time, difficulty,
/// weak subjects, and tomorrow's classes. Each one adds points and a short
/// reason, so the app can show "Due tomorrow · Weak subject" next to a task
/// instead of a mysterious order the student has no reason to trust.
library;

import '../models/task.dart';
import 'dates.dart';

class Priority {
  Priority(this.score, this.reasons);
  final double score;
  final List<String> reasons;
}

Priority scoreTask(Task t,
    {required DateTime now, required Settings settings}) {
  final reasons = <String>[];
  var score = 0.0;

  if (t.locked) {
    // Locked tasks are the student's call; nothing outranks them.
    score += 1000;
    reasons.add('Locked');
  }

  final days = daysBetween(now, t.due);
  if (days < 0) {
    score += 120;
    reasons.add('Overdue');
  } else if (days == 0) {
    score += 100;
    reasons.add('Due today');
  } else if (days == 1) {
    score += 80;
    reasons.add('Due tomorrow');
  } else if (days == 2) {
    score += 55;
  } else if (days == 3) {
    score += 40;
  } else {
    score += (40 - (days - 3) * 5).clamp(5, 40).toDouble();
  }

  if (settings.weakSubjects.contains(t.subject)) {
    score += 15;
    reasons.add('Weak subject');
  }

  // Exams and big projects need to start days before the deadline; a pure
  // deadline sort leaves them until the night before.
  if ((t.type == TaskType.exam || t.type == TaskType.project) &&
      days >= 2 &&
      days <= 7) {
    // Kept smaller than the gap between "due tomorrow" and "due in two
    // days", so tonight's homework still comes before an early start.
    score += t.remainingMinutes >= 60 && days >= 3 ? 20 : 10;
    reasons.add(t.type == TaskType.exam ? 'Exam coming' : 'Start early');
  }

  final tomorrow = dayOf(now).add(const Duration(days: 1));
  final tomorrowClasses = settings.timetable[tomorrow.weekday] ?? const [];
  if (tomorrowClasses.contains(t.subject) && days >= 1) {
    score += 10;
    reasons.add('Class tomorrow');
  }

  // Harder work goes earlier in the evening, while attention is fresher.
  score += (t.difficulty - 2) * 6;
  if (t.difficulty == 3) reasons.add('Hard');

  return Priority(score, reasons);
}

/// Open tasks that are not postponed past [now], highest priority first.
/// Ties go to the shorter task, so a quick win comes before a long slog.
List<Task> rankTasks(Iterable<Task> tasks,
    {required DateTime now, required Settings settings}) {
  final today = dayOf(now);
  final open = tasks
      .where((t) => t.isOpen)
      .where((t) =>
          t.deferredUntil == null || !dayOf(t.deferredUntil!).isAfter(today))
      .toList();
  final scores = {
    for (final t in open) t.id: scoreTask(t, now: now, settings: settings).score
  };
  open.sort((a, b) {
    final c = scores[b.id]!.compareTo(scores[a.id]!);
    return c != 0 ? c : a.remainingMinutes.compareTo(b.remainingMinutes);
  });
  return open;
}
