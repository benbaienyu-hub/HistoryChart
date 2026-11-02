import 'package:flutter_test/flutter_test.dart';
import 'package:studyorbit/logic/task_parser.dart';
import 'package:studyorbit/models/task.dart';

// Tuesday 3 November 2026, 3:30 PM — just home from school.
final now = DateTime(2026, 11, 3, 15, 30);

void main() {
  group('parseLine', () {
    test('reads subject, due date and time from a typical typed line', () {
      final d = parseLine('Math p.45 #1-20 due tomorrow 30 min', now: now)!;
      expect(d.task.subject, 'Math');
      expect(d.task.due, DateTime(2026, 11, 4));
      expect(d.task.estMinutes, 30);
      expect(d.dueGuessed, isFalse);
      expect(d.minutesGuessed, isFalse);
      // The date and duration are pulled out of the title, the work stays.
      expect(d.task.title, contains('p.45'));
      expect(d.task.title, isNot(contains('tomorrow')));
    });

    test('does not read a worksheet range like "#1-20" as January 20th', () {
      final d = parseLine('Algebra worksheet #1-20', now: now)!;
      expect(d.task.due, DateTime(2026, 11, 4));
      expect(d.dueGuessed, isTrue,
          reason: 'no real date was given, so the student must check it');
    });

    test('a weekday means the next one after today, never today', () {
      // "Due Tuesday" said on a Tuesday is next week's Tuesday.
      expect(parseLine('Bio lab due Tuesday', now: now)!.task.due,
          DateTime(2026, 11, 10));
      expect(parseLine('Chem quiz Friday', now: now)!.task.due,
          DateTime(2026, 11, 6));
    });

    test('reads month names and numeric dates', () {
      expect(parseLine('History essay due Nov 14', now: now)!.task.due,
          DateTime(2026, 11, 14));
      expect(parseLine('English reading due 11/20', now: now)!.task.due,
          DateTime(2026, 11, 20));
    });

    test('a date early next year written in November rolls into next year',
        () {
      expect(parseLine('Project due 1/10', now: now)!.task.due,
          DateTime(2027, 1, 10));
    });

    test('reads hours, half hours and hour-minute durations', () {
      expect(parseLine('essay 2 hours', now: now)!.task.estMinutes, 120);
      expect(parseLine('read half an hour', now: now)!.task.estMinutes, 30);
      expect(parseLine('lab report 1h 30m', now: now)!.task.estMinutes, 90);
    });

    test('recognises task types from their wording', () {
      expect(parseLine('Physics test Friday', now: now)!.task.type,
          TaskType.exam);
      expect(parseLine('Math quiz corrections', now: now)!.task.type,
          TaskType.quizCorrection);
      expect(parseLine('History research paper', now: now)!.task.type,
          TaskType.project);
      expect(parseLine('Read chapter 5', now: now)!.task.type,
          TaskType.reading);
    });

    test('the subject named first wins: a History essay is History', () {
      expect(parseLine('History essay due Friday', now: now)!.task.subject,
          'History');
    });

    test('difficulty words set the difficulty and leave the title', () {
      final d = parseLine('Chem lab report due Thursday, hard', now: now)!;
      expect(d.task.difficulty, 3);
      expect(d.task.title, 'Chem lab report');
    });

    test('marks an unknown subject as a guess rather than inventing one', () {
      final d = parseLine('worksheet due tomorrow', now: now)!;
      expect(d.task.subject, 'General');
      expect(d.subjectGuessed, isTrue);
    });
  });

  group('parseTasks', () {
    test('a subject written alone on the board heads the lines below it', () {
      final drafts = parseTasks('CHEMISTRY\np. 112 #3-9\nLab report due Fri',
          now: now, source: TaskSource.photo);
      expect(drafts, hasLength(2));
      expect(drafts.every((d) => d.task.subject == 'Chemistry'), isTrue);
      expect(drafts.every((d) => d.task.source == TaskSource.photo), isTrue);
    });

    test('splits a spoken list on "and then"', () {
      final drafts = parseTasks(
          'math homework due tomorrow and then study for the bio test on '
          'friday and then read english chapter 3',
          now: now,
          source: TaskSource.voice);
      expect(drafts.map((d) => d.task.subject),
          ['Math', 'Biology', 'English']);
      expect(drafts[1].task.type, TaskType.exam);
    });

    test('"due next week" is not split in half', () {
      final drafts = parseTasks('Spanish project due next week', now: now);
      expect(drafts, hasLength(1));
      expect(drafts.single.task.due, DateTime(2026, 11, 10));
    });

    test('ignores blank lines and stray bullets', () {
      final drafts = parseTasks('\n- Math hw\n\n•\n2) Bio notes\n', now: now);
      expect(drafts, hasLength(2));
    });
  });
}
