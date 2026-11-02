/// Turns free text — typed, spoken, or read off a photo — into task drafts.
///
/// This is deliberately rule-based and runs entirely on the phone. The plan
/// promises that voice is processed locally and photos stay on the device
/// (§4), and a cloud language model would break that promise the moment it
/// was called. The rules cover the common shapes ("Math p.45 #1-20 due
/// tomorrow, 30 min"); anything they are unsure of is flagged so the student
/// checks it before it is saved (§3 step 4, §14). A language-model parser
/// can replace [parseTasks] later without the screens changing.
library;

import '../models/task.dart';
import 'dates.dart';

class TaskDraft {
  TaskDraft(this.task, {required this.dueGuessed, required this.minutesGuessed,
      required this.subjectGuessed});

  final Task task;

  /// True when no date was found and a default was used. The review screen
  /// highlights these, because a silently wrong deadline is the worst
  /// mistake this app can make.
  final bool dueGuessed;
  final bool minutesGuessed;
  final bool subjectGuessed;
}

/// Subject → words that identify it. Order matters only in that the first
/// match wins, so the more specific science names sit before "science".
const Map<String, List<String>> subjectKeywords = {
  'Math': ['math', 'algebra', 'geometry', 'calculus', 'calc', 'precalc',
    'pre-calc', 'trig', 'trigonometry', 'statistics', 'stats', 'ap stat'],
  'English': ['english', 'essay', 'literature', 'lit', 'grammar', 'novel',
    'poem', 'vocab'],
  'Biology': ['biology', 'bio'],
  'Chemistry': ['chemistry', 'chem'],
  'Physics': ['physics', 'phys'],
  'History': ['history', 'apush', 'world history', 'us history', 'ushistory',
    'euro'],
  'Government': ['government', 'gov', 'civics'],
  'Economics': ['economics', 'econ', 'macro', 'micro'],
  'Spanish': ['spanish', 'español'],
  'French': ['french', 'français'],
  'Chinese': ['chinese', 'mandarin', '中文'],
  'Computer Science': ['computer science', 'comp sci', 'cs', 'coding',
    'programming', 'java', 'python'],
  'Psychology': ['psychology', 'psych'],
  'Art': ['art', 'drawing', 'painting'],
  'Music': ['music', 'band', 'orchestra', 'choir'],
  'Science': ['science', 'earth science', 'environmental', 'apes'],
};

List<String> get knownSubjects => subjectKeywords.keys.toList();

const Map<TaskType, int> defaultMinutes = {
  TaskType.homework: 30,
  TaskType.quizCorrection: 20,
  TaskType.exam: 60,
  TaskType.project: 60,
  TaskType.review: 30,
  TaskType.preview: 15,
  TaskType.reading: 25,
};

const _weekdays = {
  'monday': 1, 'mon': 1,
  'tuesday': 2, 'tue': 2, 'tues': 2,
  'wednesday': 3, 'wed': 3,
  'thursday': 4, 'thu': 4, 'thur': 4, 'thurs': 4,
  'friday': 5, 'fri': 5,
  'saturday': 6, 'sat': 6,
  'sunday': 7, 'sun': 7,
};

const _months = {
  'jan': 1, 'january': 1, 'feb': 2, 'february': 2, 'mar': 3, 'march': 3,
  'apr': 4, 'april': 4, 'may': 5, 'jun': 6, 'june': 6, 'jul': 7, 'july': 7,
  'aug': 8, 'august': 8, 'sep': 9, 'sept': 9, 'september': 9, 'oct': 10,
  'october': 10, 'nov': 11, 'november': 11, 'dec': 12, 'december': 12,
};

int _idCounter = 0;
String newId() =>
    '${DateTime.now().microsecondsSinceEpoch}-${_idCounter++}';

/// Splits [text] into lines that each describe one task, and parses each.
///
/// A line that is only a subject name ("MATH" written on a board, followed
/// by the problems underneath) becomes a heading for the lines after it
/// rather than a task of its own.
List<TaskDraft> parseTasks(String text,
    {required DateTime now, TaskSource source = TaskSource.text}) {
  final lines = splitIntoLines(text);
  final drafts = <TaskDraft>[];
  String? heading;
  for (final line in lines) {
    final onlySubject = _subjectHeading(line);
    if (onlySubject != null) {
      heading = onlySubject;
      continue;
    }
    final d = parseLine(line, now: now, source: source, fallbackSubject: heading);
    if (d != null) drafts.add(d);
  }
  return drafts;
}

List<String> splitIntoLines(String text) {
  // Voice transcripts arrive as one long sentence; "and then" / "also" /
  // "next" are how people list things out loud.
  final spoken = text.replaceAll(
      RegExp(r'\b(and then|and also|also)\b', caseSensitive: false), '\n');
  return spoken
      .split(RegExp(r'[\n;•]+|(?<=\.)\s+(?=[A-Z])'))
      .map((l) => l.replaceFirst(RegExp(r'^\s*(\d+[.)]|[-*–])\s+'), '').trim())
      .where((l) => l.replaceAll(RegExp(r'[^A-Za-z0-9一-鿿]'), '').length >= 2)
      .toList();
}

String? _subjectHeading(String line) {
  final cleaned =
      line.toLowerCase().replaceAll(RegExp(r'[^a-z一-鿿 ]'), '').trim();
  for (final e in subjectKeywords.entries) {
    if (e.key.toLowerCase() == cleaned || e.value.contains(cleaned)) {
      return e.key;
    }
  }
  return null;
}

/// The subject named *earliest* in the line wins: in "History essay" the
/// student said History first, and "essay" only describes the work.
String? detectSubject(String line) {
  final lower = ' ${line.toLowerCase()} ';
  String? best;
  var bestAt = 1 << 30;
  for (final e in subjectKeywords.entries) {
    for (final k in e.value) {
      final m = RegExp('(^|[^a-z])${RegExp.escape(k)}([^a-z]|\$)')
          .firstMatch(lower);
      if (m != null && m.start < bestAt) {
        bestAt = m.start;
        best = e.key;
      }
    }
  }
  return best;
}

TaskType detectType(String line) {
  final l = line.toLowerCase();
  bool has(String p) => RegExp(p).hasMatch(l);
  if (has(r'correction|redo (the )?quiz|fix (the )?quiz|quiz fix')) {
    return TaskType.quizCorrection;
  }
  if (has(r'\b(test|exam|midterm|final|quiz)\b')) return TaskType.exam;
  if (has(r'\b(project|report|essay|paper|presentation|poster|lab write)')) {
    return TaskType.project;
  }
  if (has(r'\b(preview|prepare for|prep for)\b')) return TaskType.preview;
  if (has(r'\b(review|study|go over)\b')) return TaskType.review;
  if (has(r'\b(read|reading|chapter|ch\.)')) return TaskType.reading;
  return TaskType.homework;
}

class _Found<T> {
  _Found(this.value, this.match);
  final T value;
  final String match;
}

/// Finds a due date in [line]. Returns null when there is none.
_Found<DateTime>? _findDue(String line, DateTime now) {
  final l = line.toLowerCase();
  final today = dayOf(now);

  final rel = RegExp(r'\b(due\s+)?(today|tonight|tomorrow|tmrw|tmr|next week)\b')
      .firstMatch(l);
  if (rel != null) {
    final word = rel.group(2)!;
    final days = switch (word) {
      'today' || 'tonight' => 0,
      'next week' => 7,
      _ => 1,
    };
    return _Found(today.add(Duration(days: days)), rel.group(0)!);
  }

  final inDays = RegExp(r'\b(due\s+)?in\s+(\d+)\s+days?\b').firstMatch(l);
  if (inDays != null) {
    return _Found(today.add(Duration(days: int.parse(inDays.group(2)!))),
        inDays.group(0)!);
  }

  // 11/5 or 11/05/2026. A dash is only read as a date after "due", because
  // "#1-20" on a worksheet is a range of problems, not January 20th.
  final numeric = RegExp(
          r'\b(due\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b|\b(due\s+)(\d{1,2})-(\d{1,2})\b')
      .firstMatch(l);
  if (numeric != null) {
    final m = int.parse(numeric.group(2) ?? numeric.group(6)!);
    final d = int.parse(numeric.group(3) ?? numeric.group(7)!);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      var y = numeric.group(4) != null ? int.parse(numeric.group(4)!) : now.year;
      if (y < 100) y += 2000;
      var date = DateTime(y, m, d);
      // "1/10" written in December means next January.
      if (numeric.group(4) == null && daysBetween(today, date) < -30) {
        date = DateTime(y + 1, m, d);
      }
      return _Found(date, numeric.group(0)!);
    }
  }

  // Nov 5, November 5th, 5 Nov
  final monthNames = _months.keys.join('|');
  final named = RegExp('\\b(due\\s+)?(?:($monthNames)\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?|(\\d{1,2})(?:st|nd|rd|th)?\\s+($monthNames))\\b')
      .firstMatch(l);
  if (named != null) {
    final month = _months[named.group(2) ?? named.group(5)]!;
    final day = int.parse(named.group(3) ?? named.group(4)!);
    var date = DateTime(now.year, month, day);
    if (daysBetween(today, date) < -30) date = DateTime(now.year + 1, month, day);
    return _Found(date, named.group(0)!);
  }

  // Weekday names: the next one *after* today. Homework "due Friday" said
  // on a Friday almost always means next week's Friday.
  final names = _weekdays.keys.toList()
    ..sort((a, b) => b.length.compareTo(a.length));
  final wd = RegExp('\\b(due\\s+|on\\s+|by\\s+|this\\s+|next\\s+)?(${names.join('|')})\\b')
      .firstMatch(l);
  if (wd != null) {
    final target = _weekdays[wd.group(2)]!;
    var delta = (target - now.weekday) % 7;
    if (delta == 0) delta = 7;
    return _Found(today.add(Duration(days: delta)), wd.group(0)!);
  }
  return null;
}

_Found<int>? _findMinutes(String line) {
  final l = line.toLowerCase();
  final hm = RegExp(r'(\d+)\s*h(?:ours?|rs?)?\s*(\d+)\s*m(?:in(?:ute)?s?)?\b')
      .firstMatch(l);
  if (hm != null) {
    return _Found(int.parse(hm.group(1)!) * 60 + int.parse(hm.group(2)!),
        hm.group(0)!);
  }
  final hours = RegExp(r'(\d+(?:\.\d+)?|\ban?|\bhalf an?)\s*(?:h|hr|hrs|hour|hours)\b')
      .firstMatch(l);
  if (hours != null) {
    final raw = hours.group(1)!;
    final h = raw.startsWith('half') ? 0.5 : (raw == 'a' || raw == 'an') ? 1.0 : double.parse(raw);
    return _Found((h * 60).round(), hours.group(0)!);
  }
  final mins = RegExp(r'(\d+)\s*(?:m|min|mins|minute|minutes)\b').firstMatch(l);
  if (mins != null) return _Found(int.parse(mins.group(1)!), mins.group(0)!);
  return null;
}

int _difficulty(String line) {
  final l = line.toLowerCase();
  if (RegExp(r'\b(hard|difficult|tough|challenging)\b').hasMatch(l)) return 3;
  if (RegExp(r'\b(easy|quick|short|simple)\b').hasMatch(l)) return 1;
  return 2;
}

TaskDraft? parseLine(String line,
    {required DateTime now,
    TaskSource source = TaskSource.text,
    String? fallbackSubject}) {
  final type = detectType(line);
  final due = _findDue(line, now);
  final minutes = _findMinutes(line);
  final subject = detectSubject(line) ?? fallbackSubject;

  var title = line;
  for (final m in [due?.match, minutes?.match]) {
    if (m != null) {
      title = title.replaceFirst(RegExp(RegExp.escape(m), caseSensitive: false), '');
    }
  }
  title = title
      .replaceAll(RegExp(r'\b(it\s+)?(is\s+)?due\b', caseSensitive: false), '')
      // Difficulty words are stored as difficulty, not left in the title.
      .replaceAll(
          RegExp(r',?\s*\b(really\s+|very\s+)?(hard|difficult|tough|challenging|easy|quick)\b',
              caseSensitive: false),
          '')
      .replaceAll(RegExp(r'\s+,'), ',')
      .replaceAll(RegExp(r'\b(about|around|takes?|for)\s*$', caseSensitive: false), '')
      .replaceAll(RegExp(r'\s{2,}'), ' ')
      .replaceAll(RegExp(r'^[\s,:\-–]+|[\s,:\-–.]+$'), '')
      .trim();
  // A subject followed by a colon ("Math: p.45") reads better without it.
  if (subject != null) {
    title = title
        .replaceFirst(RegExp('^${RegExp.escape(subject)}\\s*[:\\-–]\\s*',
            caseSensitive: false), '')
        .trim();
  }
  if (title.isEmpty) title = type.label;
  if (title.length > 1) title = title[0].toUpperCase() + title.substring(1);

  // With no date, assume the next school day: that is when most homework is
  // due, and the review screen marks it so the student can correct it.
  final defaultDue = dayOf(now).add(const Duration(days: 1));

  return TaskDraft(
    Task(
      id: newId(),
      subject: subject ?? 'General',
      title: title,
      type: type,
      due: due?.value ?? defaultDue,
      estMinutes: minutes?.value ?? defaultMinutes[type]!,
      difficulty: _difficulty(line),
      source: source,
      sourceText: line,
    ),
    dueGuessed: due == null,
    minutesGuessed: minutes == null,
    subjectGuessed: subject == null,
  );
}
