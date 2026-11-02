import 'dart:async';

import 'package:flutter/material.dart';

import '../logic/dates.dart';
import '../logic/planner.dart';
import 'app_scope.dart';
import 'focus_screen.dart';
import 'task_edit_screen.dart';
import 'theme.dart';

class TonightScreen extends StatefulWidget {
  const TonightScreen({super.key});

  @override
  State<TonightScreen> createState() => _TonightScreenState();
}

class _TonightScreenState extends State<TonightScreen> {
  Timer? _tick;

  @override
  void initState() {
    super.initState();
    // The plan starts from "now", so it has to be redrawn as time passes.
    _tick = Timer.periodic(const Duration(minutes: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final now = state.clock();
    final plan = buildEveningPlan(
        tasks: state.tasks, settings: state.settings, now: now);
    final checklist = tomorrowChecklist(
        tasks: state.tasks, settings: state.settings, now: now);
    final text = Theme.of(context).textTheme;

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
      children: [
        Text('${weekdayNames[now.weekday - 1]} · 4:00 – 9:00 PM',
            style: text.titleMedium),
        const SizedBox(height: 4),
        Text(
          plan.over
              ? "Tonight's study window is over. Rest — tomorrow's plan "
                  'starts at 4:00.'
              : plan.studyMinutes == 0
                  ? 'Nothing to do tonight. Add homework with the + button.'
                  : '${plan.studyMinutes} min of study, with breaks, dinner '
                      'and free time.',
          style: text.bodyMedium,
        ),
        const SizedBox(height: 12),
        if (plan.leftovers.any((l) => l.urgent))
          _LeftoverCard(plan.leftovers.where((l) => l.urgent).toList()),
        for (final b in plan.blocks) _BlockTile(block: b, now: now),
        if (plan.leftovers.any((l) => !l.urgent))
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text(
              'Continues another evening: '
              '${plan.leftovers.where((l) => !l.urgent).map((l) => '${l.title} (${l.minutes} min)').join(', ')}',
              style: text.bodySmall,
            ),
          ),
        const SizedBox(height: 20),
        if (checklist.isNotEmpty) ...[
          Text('Ready for tomorrow', style: text.titleMedium),
          const SizedBox(height: 6),
          Card(
            child: Column(children: [
              for (final c in checklist)
                ListTile(
                  dense: true,
                  leading: const Icon(Icons.check_box_outline_blank, size: 20),
                  title: Text(c),
                ),
            ]),
          ),
        ],
      ],
    );
  }
}

class _LeftoverCard extends StatelessWidget {
  const _LeftoverCard(this.items);
  final List<Leftover> items;

  @override
  Widget build(BuildContext context) {
    final s = Theme.of(context).colorScheme;
    final total = items.fold(0, (a, l) => a + l.minutes);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        color: s.errorContainer,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text("Due soon but doesn't fit tonight · $total min",
                  style: TextStyle(
                      color: s.onErrorContainer, fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              for (final l in items.take(4))
                Text('• ${l.title} (${l.minutes} min)',
                    style: TextStyle(color: s.onErrorContainer)),
              if (items.length > 4)
                Text('and ${items.length - 4} more',
                    style: TextStyle(color: s.onErrorContainer)),
              const SizedBox(height: 4),
              Text(
                  'Postpone something, shorten an estimate, or lock what '
                  'matters most.',
                  style: TextStyle(color: s.onErrorContainer, fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }
}

class _BlockTile extends StatelessWidget {
  const _BlockTile({required this.block, required this.now});
  final PlanBlock block;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final color = blockColor(context, block.kind);
    final isNow = !now.isBefore(block.start) && now.isBefore(block.end);
    final state = AppScope.of(context);
    final task = state.byId(block.taskId);
    final s = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Material(
        color: isNow ? s.primaryContainer : s.surfaceContainerLow,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: block.isWork
              ? () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => FocusScreen(block: block)))
              : null,
          onLongPress: task == null
              ? null
              : () => Navigator.of(context).push(MaterialPageRoute(
                  builder: (_) => TaskEditScreen(task: task))),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            child: Row(children: [
              SizedBox(
                width: 52,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(clock(block.start),
                        style: const TextStyle(fontWeight: FontWeight.w600)),
                    Text('${block.minutes}m',
                        style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              Container(
                width: 4,
                height: block.isWork ? 40 : 28,
                decoration: BoxDecoration(
                    color: color, borderRadius: BorderRadius.circular(2)),
              ),
              const SizedBox(width: 10),
              Icon(blockIcon(block.kind), size: 20, color: color),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(block.title,
                        style: TextStyle(
                            fontWeight:
                                block.isWork ? FontWeight.w600 : FontWeight.w400)),
                    if (block.subject != null)
                      Text(block.subject!,
                          style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
              if (block.isWork)
                Icon(Icons.play_circle_outline, color: s.primary),
            ]),
          ),
        ),
      ),
    );
  }
}
