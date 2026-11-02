import 'package:flutter_test/flutter_test.dart';
import 'package:studyorbit/logic/task_splitter.dart';
import 'package:studyorbit/models/task.dart';

import 'helpers.dart';

final due = DateTime(2026, 11, 10);

void main() {
  test('a project splits into research, outline, draft and revise', () {
    final steps = suggestSteps(task(type: TaskType.project, due: due, minutes: 120));
    expect(steps.map((s) => s.title).first, contains('sources'));
    expect(steps, hasLength(4));
    // The steps roughly add back up to the estimate.
    final total = steps.fold(0, (a, s) => a + s.minutes);
    expect(total, inInclusiveRange(110, 130));
  });

  test('short homework is not split — that would only add clicking', () {
    expect(suggestSteps(task(due: due, minutes: 30)), isEmpty);
  });

  test('long plain homework splits into even parts', () {
    final steps = suggestSteps(task(due: due, minutes: 75));
    expect(steps, hasLength(3));
    expect(steps.first.title, 'Part 1 of 3');
    expect(steps.every((s) => s.minutes == 25), isTrue);
  });

  test('a split task counts only its unfinished steps as remaining', () {
    final t = task(type: TaskType.exam, due: due, minutes: 60);
    t.steps = suggestSteps(t);
    final before = t.remainingMinutes;
    t.steps.first.done = true;
    expect(t.remainingMinutes, before - t.steps.first.minutes);
  });
}
