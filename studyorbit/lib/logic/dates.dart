/// Small date helpers shared by the parser, prioritiser and planner.
///
/// Everything in StudyOrbit thinks in whole days for deadlines, so the
/// comparison helpers strip the time first. Without that, homework due
/// "tomorrow" read at 11pm would count as less than one day away.
library;

DateTime dayOf(DateTime d) => DateTime(d.year, d.month, d.day);

// Counted on UTC calendar dates so a daylight-saving day (23 or 25 hours
// long locally) still counts as exactly one day.
int daysBetween(DateTime from, DateTime to) =>
    DateTime.utc(to.year, to.month, to.day)
        .difference(DateTime.utc(from.year, from.month, from.day))
        .inDays;

bool sameDay(DateTime a, DateTime b) =>
    a.year == b.year && a.month == b.month && a.day == b.day;

DateTime atMinutes(DateTime day, int minutesAfterMidnight) => DateTime(
    day.year, day.month, day.day, minutesAfterMidnight ~/ 60,
    minutesAfterMidnight % 60);

const weekdayNames = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

String clock(DateTime t) {
  final h = t.hour % 12 == 0 ? 12 : t.hour % 12;
  final m = t.minute.toString().padLeft(2, '0');
  return '$h:$m';
}

String shortDate(DateTime d, {DateTime? today}) {
  final t = today ?? DateTime.now();
  final diff = daysBetween(t, d);
  if (diff == 0) return 'Today';
  if (diff == 1) return 'Tomorrow';
  if (diff == -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return weekdayNames[d.weekday - 1];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];
  return '${months[d.month - 1]} ${d.day}';
}
