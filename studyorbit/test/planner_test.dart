import 'package:flutter_test/flutter_test.dart';
import 'package:studyorbit/logic/planner.dart';
import 'package:studyorbit/models/task.dart';

import 'helpers.dart';

final tomorrow = DateTime(2026, 11, 4);
DateTime at(int h, [int m = 0]) => DateTime(2026, 11, 3, h, m);

void main() {
  test('the plan runs from 4:00 to 9:00 with no gaps or overlaps', () {
    final plan = buildEveningPlan(
      tasks: [task(due: tomorrow, minutes: 50), task(due: tomorrow, minutes: 40)],
      settings: Settings(),
      now: at(15, 30),
    );
    expect(plan.blocks.first.start, at(16));
    expect(plan.blocks.last.end, at(21));
    for (var i = 1; i < plan.blocks.length; i++) {
      expect(plan.blocks[i].start, plan.blocks[i - 1].end,
          reason: 'block $i should start where the last one ended');
    }
  });

  test('dinner is always in the plan at the set time', () {
    final plan = buildEveningPlan(
        tasks: [task(due: tomorrow, minutes: 240)],
        settings: Settings(),
        now: at(16));
    final dinner = plan.blocks.where((b) => b.kind == BlockKind.dinner).single;
    expect(dinner.start, at(18));
    expect(dinner.minutes, 30);
  });

  test('long work is cut into focus blocks with breaks between them', () {
    final plan = buildEveningPlan(
        tasks: [task(title: 'Essay', due: tomorrow, minutes: 75)],
        settings: Settings(focusMinutes: 25, breakMinutes: 5),
        now: at(16));
    final work = plan.blocks.where((b) => b.isWork).toList();
    expect(work, hasLength(3));
    expect(work.every((b) => b.minutes <= 25), isTrue);
    expect(work.first.title, 'Essay · part 1');
    expect(plan.blocks[1].kind, BlockKind.rest);
  });

  test('keeps free time at the end of the evening', () {
    final plan = buildEveningPlan(
        tasks: [task(due: tomorrow, minutes: 600)],
        settings: Settings(),
        now: at(16));
    final lastWork = plan.blocks.lastWhere((b) => b.isWork);
    expect(lastWork.end.isAfter(at(20, 30)), isFalse);
    expect(plan.blocks.last.kind, BlockKind.free);
  });

  test('work that does not fit is reported, not dropped', () {
    final plan = buildEveningPlan(
        tasks: [task(title: 'Huge', due: tomorrow, minutes: 600)],
        settings: Settings(),
        now: at(16));
    expect(plan.leftovers.single.title, 'Huge');
    expect(plan.leftovers.single.minutes + plan.studyMinutes, 600);
  });

  test('only work due soon is flagged as urgent when it does not fit', () {
    final plan = buildEveningPlan(
        tasks: [
          task(title: 'Tonight', due: tomorrow, minutes: 200),
          task(title: 'Next week', due: DateTime(2026, 11, 12), minutes: 200),
        ],
        settings: Settings(),
        now: at(16));
    final byTitle = {for (final l in plan.leftovers) l.title: l};
    expect(byTitle['Next week']!.urgent, isFalse);
    expect(byTitle.containsKey('Tonight') ? byTitle['Tonight']!.urgent : true,
        isTrue);
  });

  test('re-plans from the current time when opened late', () {
    final plan = buildEveningPlan(
        tasks: [task(due: tomorrow, minutes: 30)],
        settings: Settings(),
        now: at(17, 42));
    expect(plan.blocks.first.start, at(17, 45));
  });

  test('after 9 PM there is no plan, and the work is listed as left over', () {
    final plan = buildEveningPlan(
        tasks: [task(due: tomorrow)], settings: Settings(), now: at(21, 5));
    expect(plan.over, isTrue);
    expect(plan.blocks, isEmpty);
    expect(plan.leftovers, hasLength(1));
  });

  test("adds tomorrow's previews and today's weak-subject reviews", () {
    final settings = Settings(
      weakSubjects: {'Chemistry'},
      timetable: {
        DateTime.tuesday: ['Chemistry', 'English'],
        DateTime.wednesday: ['Math'],
      },
    );
    final plan = buildEveningPlan(tasks: [], settings: settings, now: at(16));
    final titles = plan.blocks.map((b) => b.title).toList();
    expect(titles, contains('Preview Math for tomorrow'));
    expect(titles, contains("Review today's Chemistry class"));
    // English is not weak, so it gets no automatic review.
    expect(titles.any((t) => t.contains('English')), isFalse);
  });

  test('a split task is planned step by step and remembers which step', () {
    final t = task(title: 'Lab', due: tomorrow, minutes: 40, steps: [
      TaskStep(title: 'Data', minutes: 20, done: true),
      TaskStep(title: 'Write-up', minutes: 20),
    ]);
    final plan = buildEveningPlan(tasks: [t], settings: Settings(), now: at(16));
    final work = plan.blocks.where((b) => b.isWork).toList();
    expect(work, hasLength(1));
    expect(work.single.title, 'Lab: Write-up');
    expect(work.single.stepIndex, 1);
  });

  test("tomorrow's checklist lists classes and what to hand in", () {
    final items = tomorrowChecklist(
      tasks: [task(subject: 'Math', title: 'p.45', due: tomorrow)],
      settings: Settings(timetable: {DateTime.wednesday: ['Biology']}),
      now: at(16),
    );
    expect(items, contains('Biology: skim the next lesson and pack materials'));
    expect(items, contains('Hand in: Math — p.45'));
  });

  test('works on the day clocks change', () {
    // 1 Nov 2026 is the US end of daylight saving time.
    final sunday = DateTime(2026, 11, 1, 16);
    final plan = buildEveningPlan(
        tasks: [task(due: DateTime(2026, 11, 2))],
        settings: Settings(),
        now: sunday);
    expect(plan.blocks.last.end.hour, 21);
  });

}
