import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../logic/planner.dart';
import 'app_scope.dart';

/// The study timer (plan §2 学习计时, 休息提醒).
///
/// Counts down one plan block, then switches to a break and says so. Time
/// actually spent is logged when the student leaves, whether they finished
/// or not — the history should show real effort, not just completed tasks.
class FocusScreen extends StatefulWidget {
  const FocusScreen({super.key, required this.block});
  final PlanBlock block;

  @override
  State<FocusScreen> createState() => _FocusScreenState();
}

enum _Phase { focus, rest, finished }

class _FocusScreenState extends State<FocusScreen> {
  Timer? _timer;
  late int _secondsLeft;
  int _focusSeconds = 0;
  bool _running = true;
  _Phase _phase = _Phase.focus;
  bool _logged = false;

  @override
  void initState() {
    super.initState();
    _secondsLeft = widget.block.minutes * 60;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) => _tickOnce());
  }

  void _tickOnce() {
    if (!_running || _phase == _Phase.finished) return;
    setState(() {
      _secondsLeft--;
      if (_phase == _Phase.focus) _focusSeconds++;
      if (_secondsLeft <= 0) _phaseOver();
    });
  }

  void _phaseOver() {
    HapticFeedback.heavyImpact();
    SystemSound.play(SystemSoundType.alert);
    if (_phase == _Phase.focus) {
      final rest = AppScope.read(context).settings.breakMinutes;
      _phase = _Phase.rest;
      _secondsLeft = rest * 60;
      if (rest == 0) _phase = _Phase.finished;
    } else {
      _phase = _Phase.finished;
    }
  }

  void _logTime() {
    if (_logged) return;
    _logged = true;
    final state = AppScope.read(context);
    final minutes = (_focusSeconds / 60).round();
    state.logStudy(state.byId(widget.block.taskId), minutes, widget.block.title);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _leave() {
    _logTime();
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final state = AppScope.of(context);
    final task = state.byId(widget.block.taskId);
    final s = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final mm = (_secondsLeft ~/ 60).toString().padLeft(2, '0');
    final ss = (_secondsLeft % 60).toString().padLeft(2, '0');
    final stepIndex = widget.block.stepIndex;

    final headline = switch (_phase) {
      _Phase.focus => 'Focus',
      _Phase.rest => 'Break — rest your eyes',
      _Phase.finished => 'Block done',
    };

    return PopScope(
      onPopInvokedWithResult: (didPop, _) {
        if (didPop) _logTime();
      },
      child: Scaffold(
        appBar: AppBar(title: Text(widget.block.subject ?? 'Study')),
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(widget.block.title,
                    style: text.titleLarge, textAlign: TextAlign.center),
                const Spacer(),
                Text(headline,
                    textAlign: TextAlign.center,
                    style: text.titleMedium?.copyWith(
                        color: _phase == _Phase.rest ? s.tertiary : s.primary)),
                if (_phase != _Phase.finished)
                  Text('$mm:$ss',
                      textAlign: TextAlign.center,
                      style: text.displayLarge?.copyWith(
                          fontFeatures: const [FontFeature.tabularFigures()])),
                if (_phase == _Phase.rest)
                  const Padding(
                    padding: EdgeInsets.only(top: 8),
                    child: Text(
                        'Look at something 20 feet away. Stand up. '
                        'Drink some water.',
                        textAlign: TextAlign.center),
                  ),
                const SizedBox(height: 16),
                if (_phase != _Phase.finished)
                  Center(
                    child: IconButton.filledTonal(
                      iconSize: 36,
                      onPressed: () => setState(() => _running = !_running),
                      icon: Icon(_running ? Icons.pause : Icons.play_arrow),
                    ),
                  ),
                const Spacer(),
                if (task != null && stepIndex != null && task.isOpen)
                  FilledButton.icon(
                    onPressed: () {
                      state.setStepDone(task, stepIndex, true);
                      _leave();
                    },
                    icon: const Icon(Icons.check),
                    label: const Text('Step finished'),
                  ),
                if (task != null && task.isOpen) ...[
                  const SizedBox(height: 8),
                  (stepIndex == null ? FilledButton.icon : OutlinedButton.icon)(
                    onPressed: () {
                      state.setDone(task, true);
                      _leave();
                    },
                    icon: const Icon(Icons.done_all),
                    label: const Text('Whole task finished'),
                  ),
                  const SizedBox(height: 8),
                  OutlinedButton.icon(
                    onPressed: () {
                      state.postpone(task);
                      _leave();
                    },
                    icon: const Icon(Icons.schedule),
                    label: const Text('Postpone to tomorrow'),
                  ),
                ],
                const SizedBox(height: 8),
                TextButton(
                  onPressed: _leave,
                  child: Text(_phase == _Phase.finished
                      ? 'Back to tonight'
                      : 'Stop for now'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
