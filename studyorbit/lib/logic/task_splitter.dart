/// Breaks a big task into steps (plan §2 任务拆分).
///
/// "Write history essay, 2 hours" is hard to start; "Find three sources,
/// 25 min" is not. The templates follow how teachers usually describe each
/// kind of work. The student can rename or delete any step afterwards — the
/// split is a starting point, not a rule.
library;

import '../models/task.dart';

const Map<TaskType, List<(String, double)>> _templates = {
  TaskType.project: [
    ('Gather sources and requirements', 0.2),
    ('Make an outline', 0.15),
    ('Write the first draft', 0.45),
    ('Revise and proofread', 0.2),
  ],
  TaskType.exam: [
    ('Re-read notes and list key ideas', 0.3),
    ('Do practice problems', 0.4),
    ('Redo past mistakes', 0.2),
    ('Quick self-quiz', 0.1),
  ],
  TaskType.quizCorrection: [
    ('Find each wrong answer and why', 0.3),
    ('Rework the problems', 0.5),
    ('Write down what to remember', 0.2),
  ],
};

int _round5(double m) {
  final r = (m / 5).round() * 5;
  return r < 5 ? 5 : r;
}

/// Returns suggested steps for [t]. Short tasks (30 minutes or less) come
/// back empty: splitting them only adds clicking.
List<TaskStep> suggestSteps(Task t, {int chunkMinutes = 25}) {
  final total = t.estMinutes;
  final template = _templates[t.type];
  if (template != null && total >= 30) {
    return [
      for (final (title, share) in template)
        TaskStep(title: title, minutes: _round5(total * share)),
    ];
  }
  if (total <= 30) return [];
  final parts = (total / chunkMinutes).ceil();
  final each = _round5(total / parts);
  final label = t.type == TaskType.reading ? 'Read part' : 'Part';
  return [
    for (var i = 1; i <= parts; i++)
      TaskStep(title: '$label $i of $parts', minutes: each),
  ];
}
