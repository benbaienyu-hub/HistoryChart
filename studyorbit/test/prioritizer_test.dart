import 'package:flutter_test/flutter_test.dart';
import 'package:studyorbit/logic/prioritizer.dart';
import 'package:studyorbit/models/task.dart';

import 'helpers.dart';

final now = DateTime(2026, 11, 3, 16); // Tuesday
final tomorrow = DateTime(2026, 11, 4);

void main() {
  test('sooner deadlines come first', () {
    final later = task(title: 'later', due: DateTime(2026, 11, 9));
    final soon = task(title: 'soon', due: tomorrow);
    final ranked = rankTasks([later, soon], now: now, settings: Settings());
    expect(ranked.map((t) => t.title), ['soon', 'later']);
  });

  test('a weak subject outranks an equally urgent strong one', () {
    final strong = task(subject: 'English', title: 'strong', due: tomorrow);
    final weak = task(subject: 'Chemistry', title: 'weak', due: tomorrow);
    final ranked = rankTasks([strong, weak],
        now: now, settings: Settings(weakSubjects: {'Chemistry'}));
    expect(ranked.first.title, 'weak');
    expect(scoreTask(weak, now: now, settings: Settings(weakSubjects: {'Chemistry'}))
        .reasons, contains('Weak subject'));
  });

  test('an exam a few days out is started before it becomes urgent', () {
    // Without the boost, homework due in three days would tie or beat it.
    final exam = task(
        title: 'exam', type: TaskType.exam, due: DateTime(2026, 11, 6), minutes: 90);
    final hw = task(title: 'hw', due: DateTime(2026, 11, 6));
    final ranked = rankTasks([hw, exam], now: now, settings: Settings());
    expect(ranked.first.title, 'exam');
  });

  test('a locked task is always first, whatever its deadline', () {
    final locked = task(title: 'mine', due: DateTime(2026, 11, 20), locked: true);
    final urgent = task(title: 'urgent', due: DateTime(2026, 11, 3));
    final ranked = rankTasks([urgent, locked], now: now, settings: Settings());
    expect(ranked.first.title, 'mine');
  });

  test('a task postponed to tomorrow is left out of tonight', () {
    final t = task(due: tomorrow)..deferredUntil = tomorrow;
    expect(rankTasks([t], now: now, settings: Settings()), isEmpty);
    // ...and comes back the next day.
    expect(rankTasks([t], now: DateTime(2026, 11, 4, 16), settings: Settings()),
        hasLength(1));
  });

  test('done tasks are not ranked', () {
    final t = task(due: tomorrow)..status = TaskStatus.done;
    expect(rankTasks([t], now: now, settings: Settings()), isEmpty);
  });
}
