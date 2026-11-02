import 'package:flutter/material.dart';

import '../logic/planner.dart';

/// Colours come from one seed so light and dark mode stay consistent;
/// screens ask the theme for colours instead of hard-coding them.
ThemeData buildTheme(Brightness b) {
  final scheme = ColorScheme.fromSeed(
      seedColor: const Color(0xFF3E5BD8), brightness: b);
  return ThemeData(
    colorScheme: scheme,
    useMaterial3: true,
    visualDensity: VisualDensity.standard,
    cardTheme: const CardThemeData(margin: EdgeInsets.zero),
    inputDecorationTheme:
        const InputDecorationTheme(border: OutlineInputBorder(), isDense: true),
  );
}

Color blockColor(BuildContext context, BlockKind k) {
  final s = Theme.of(context).colorScheme;
  return switch (k) {
    BlockKind.study => s.primary,
    BlockKind.review => s.tertiary,
    BlockKind.preview => s.secondary,
    BlockKind.rest => s.outline,
    BlockKind.dinner => s.error,
    BlockKind.free => s.outlineVariant,
  };
}

IconData blockIcon(BlockKind k) => switch (k) {
      BlockKind.study => Icons.edit_note,
      BlockKind.review => Icons.replay,
      BlockKind.preview => Icons.visibility_outlined,
      BlockKind.rest => Icons.self_improvement,
      BlockKind.dinner => Icons.restaurant,
      BlockKind.free => Icons.sports_esports_outlined,
    };
