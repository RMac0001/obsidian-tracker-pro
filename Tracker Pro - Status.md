# Tracker Pro — Status

## What was done (v1.1.1 → v1.5.4)

---

### v1.7.10 — `{{meanDiff(propA, propB)}}` Summary Template Function

Adds a new two-argument `summary` template function for paired-day averages, primarily for food logs: `{{meanDiff(cal_total, calories_burned)}}` gives the average daily net calories (surplus/deficit) instead of the misleading difference of two separate averages.

**Behavior:** for each calendar day where **both** named properties have a value, computes `propA − propB` for that day (summing same-day duplicate points first), then averages those daily differences across only the paired days — days with just one of the two values are skipped entirely, not treated as zero. Returns `"?"` if either property isn't in the block's `properties` list (matching the existing `mean(prop)` convention), and `"N/A"` if no day has both values. Result is rounded to a whole number, prefixed with `+` when positive, a plain `-` when negative, and normalized to `"0"` (no stray `-0`) when it rounds to zero.

**Implementation:** `calcMeanDiff` in `src/charts/summaryChart.ts`, next to the existing macro-percentage helpers, reusing `getSeriesByName` and the existing `toDateOnly` local-date key (avoiding `toISOString()` UTC off-by-one). Wired into `twoArgResolver` alongside `carbPct`/`fatPct`/`proteinPct`.

**Files changed:** `src/charts/summaryChart.ts`, `Documentation.md`.

---

### v1.7.8 — Automate Release Publishing on Tag Push

Every prior version (through v1.7.7) shipped by bumping `manifest.json`/`package.json` and merging to `master` — but the actual GitHub Release (tag + published release object) had to be created by hand afterward, same as it always had been for this repo. `.github/workflows/releases.yml` only triggered on `release: types: [published]`, meaning it could attach `main.js`/`manifest.json`/`styles.css` to a release that already existed, but couldn't create one itself.

Changed the trigger to `push: tags: - 'v*'`. `softprops/action-gh-release@v2` auto-creates and publishes a release from the pushed tag when run this way, uploading the same three build artifacts in the same step — no separate "click Publish" needed. Pushing a version tag (e.g. `v1.7.8`) after a merge is now the entire remaining step.

**Files changed:** `.github/workflows/releases.yml` only.

---

### v1.7.7 — Suggest Picker Race: Selections Vanish (Phase 8)

Fixes a general defect in this plugin's shared picker infrastructure: selecting **anything** in a `StringSuggestModal`/`FileSuggestModal` (a new routine, an existing routine, an exercise from a search list) silently closed the picker and did nothing — no error anywhere. Root-caused against Obsidian's own shipped `app.js`, fetched live from the console, not guessed.

**Root cause:** Obsidian's own `SuggestModal.prototype.selectSuggestion` calls `this.close()` **before** `this.onChooseSuggestion(...)` on every selection, not just on cancel — `close()`'s `onClose()` body runs synchronously before `selectSuggestion` resumes to invoke `onChooseItem`. Three of this plugin's picker classes used a `chosen` flag idiom that assumed the opposite order (`onChooseItem` sets `chosen = true`, then `onClose` checks `if (!this.chosen) this.onChoose(null)`). Since `onClose` always ran first, the check was always true, `onChoose(null)` resolved the caller's promise immediately, and the real `onChoose(item)` call a moment later was silently discarded — a promise only settles once. The caller then saw `choice === null`, hit its own cancel guard, and exited clean. No exception anywhere, which is exactly why this needed live DevTools instrumentation (wrapped `Map.prototype.set`, real click/keyboard/programmatic `.click()` selection attempts, a `MutationObserver` on modal add/remove) to surface at all.

**Fix:** in exactly three classes — `StringSuggestModal` and `FileSuggestModal` in `src/routineTracker.ts`, and `FileSuggestModal` in `src/circuitCallerExport.ts` — wrapped the existing `if (!this.chosen) this.onChoose(null);` in `setTimeout(() => { ... }, 0)`. Deferring past the synchronous stretch where Obsidian calls `close()` then `onChooseItem` lets the real selection win the race instead of losing it every time. `mealLogger.ts`'s same-named `StringSuggestModal`/`FileSuggestModal` (no `onClose` override at all — nothing to race) and `vitaminTracker.ts`'s `VitaminPickModal` (different pattern) were confirmed unaffected and left untouched, as were every plugin-owned modal that calls its own `close()` and sets its `resolved` flag first (`RoutineNameModal`, `RoutineTargetModal`, `ExerciseFormModal`, etc.) — already correctly ordered.

**Blast radius cleared by this one fix:** Create/edit routine (new and existing), the routine builder's Add/Reorder/Remove-an-exercise pickers, Create/edit exercise (new and existing), Log workout (routine pick, exercise search, "Anything else?"), Edit workout log (session pick, exercise search), and Export routine (Circuit Caller)'s routine picker.

**Files changed:** `src/routineTracker.ts`, `src/circuitCallerExport.ts`.

---

### v1.7.6 — Auto-Pivot: Phantom Total & Missing Links (Phase 7)

Fixes a regression in Phase 6's table-chart auto-pivot (v1.7.5), root-caused live by instrumenting the running plugin in Obsidian's DevTools console (wrapping `Map.prototype.set`/`Array.prototype.push` with stack-trace capture, then restoring everything — no vault changes).

**Bug:** `buildPivotGroups` recovers each note's exercise slug by stripping known rollup suffixes (`_sets`, `_volume`, etc.) off every frontmatter key. But `total_sets`/`total_volume` — whole-session convenience fields present on every workout note — match that exact `<word>_suffix` shape (`total_volume` strips just like `recumbent_bike_speed` does), inventing a 4th phantom "exercise" literally named `total` on every session. That phantom group got its own row, and the totals row (which flattens all groups together) double-counted it into the grand total. Separately, the pivot row-label cell was always plain text — it never built a link the way the older literal-`groupBy` path does, so exercise names stopped linking to their Data/Exercises note.

**Fix 1:** `SESSION_LEVEL_KEYS = new Set(["time_min", "total_sets", "total_volume", "creation_date"])`, checked before the suffix-regex match in `buildPivotGroups`'s per-key loop — these keys are never candidates for slug-stripping. No phantom row; the real totals row goes back to summing only real exercises. (The existing per-slug `time_min`-credit fallback reads `entry.frontmatter["time_min"]` directly in a separate loop, so excluding it here doesn't touch that logic.)

**Fix 2:** `resolveDisplayNameForSlug` renamed to `resolveExerciseForSlug`, now returns `{ file, displayName }` instead of a bare string. The pivot row-label cell builds a real `<a class="internal-link">` when the file resolves, matching `renderGroupByCell`'s existing convention exactly; falls back to today's plain humanized text only for a genuinely orphaned (renamed/deleted) exercise — which, once Fix 1 lands, `total` can never be again. Resolution is cached per slug within a single render so sort + row rendering don't each rescan the exercise database.

**Files changed:** `src/charts/tableChart.ts` only.

---

### v1.7.5 — Exercise Names & Legacy Migration (Phase 6)

Reading the real vault directly turned up two gaps the earlier specs missed: (1) exercise notes are filed under an internal name (e.g. `Exercise-Recumbent-Bike.md`) with a separate `display_name`, but the plugin used `file.basename` as "the exercise name" everywhere; (2) 105 legacy timestamped single-exercise notes in the Exercise Notes folder needed a path into `Data/Workouts` so charts can show full history in one place.

**Change 1 — `display_name` everywhere, wikilinks resolved by target.** New `getExerciseDisplayName`/`parseWikilink`/`resolveWikilinkTarget` helpers in `utils.ts`. `Create/edit exercise` gains an optional Display name field. `FileSuggestModal` gains an optional `getLabel` param, used at every exercise-search call site (Log workout, Create/edit routine's "Add an exercise", Edit workout log's "Add an exercise") to show the resolved display name while still resolving to the real `TFile` underneath. `logOneExercise` now takes the resolved `TFile` directly instead of round-tripping through a name string — `EquipmentModal`/`findLastLoggedSet`/`findLastLoggedCardio` follow. Rollup slug keys use `slugify(displayName)`. Routine lines and session headings now write real wikilinks with alias (`[[Exercise-X|Display Name]]`), parsed back by link **target** only — the alias is never trusted for identity, since it can drift from the note's current `display_name` (confirmed in the real vault: an entry linking `[[Exercise-Ten-Ladders|Six Ladders]]` while that note's `display_name` is "Ten Ladders"). Pre-existing plain-text session headings (written before this change) still parse via a fallback match against known exercises' current display names/filenames.

**Change 2 — new command: Migrate legacy exercise notes.** One-time, safely re-runnable. Reads every note in the Exercise Notes folder and writes an equivalent ad hoc session note into `Data/Workouts`, reusing the date/time in each `EN-YYYY-MM-DD-HHmmss` filename; skips (idempotent) when the destination already exists. Resolves each entry's exercise link by target (handling bare, aliased, and full-path wikilink forms), falling back to the entry's own `mode` field when the link can't be resolved, and writing unresolvable entries to `Data/Workouts/Migration Report.md` instead of guessing. Field mapping is hand-rolled in a new `src/exerciseMigration.ts` rather than routed through the live `writeWorkoutLogContent` path, since several rules are genuinely migration-specific: cardio `pace`/`average_speed` are copied directly (no distance was ever recorded, so it's omitted rather than written as `0`); strength sets are reconstructed as N identical `weight × round(reps/sets)` bullets with every rollup then derived from those bullets, exactly like live logging derives them from its own sets array; both branches also populate `<slug>_duration_min` from the entry's own `time_min` (needed for Change 4's table auto-pivot to show real per-exercise minutes on migrated strength sessions). The source folder is never modified or deleted, no matter how many times the command runs.

**Change 3 — chart compatibility (docs only, no behavior change).** Documented how an existing chart pointed at the legacy folder keeps working completely unchanged for as long as wanted — migration never touches that folder. A line chart translates by pointing `folder:` at `Data/Workouts` and swapping the old flat property name for the new slug-prefixed one (e.g. `walk_pace`, `recumbent_bike_speed`). Confirmed: `Walk` and `Walk at Home` are permanently separate exercises/rollup keys — nothing in the plugin ever merges them.

**Change 4 — table chart auto-pivot.** `tableChart.ts` now auto-detects when a `groupBy` value isn't a literal frontmatter key present on the scanned notes and, instead, strips the plugin's own known rollup suffixes (`_sets`, `_reps`, `_top_weight`, `_volume`, `_duration_min`, `_distance`, `_pace`, `_speed`, `_avg_hr`, `_peak_hr`, `_equipment`) off every frontmatter key on each note to recover its exercise slug(s), then groups by those — fully auto-detected from logged data, never a hand-maintained slug list, and with **no effect on Data/Exercises** (an unrelated system: the chart's auto-pivot only decides which rows to draw from already-logged data). `buildPivotGroups` virtualizes one `RawEntry` per (note, slug) pair with generic unprefixed keys, so the existing column-value evaluator works completely unchanged against a slug's group. `sum(time_min)` in a pivoted context reads `<slug>_duration_min` when present, else credits that session's full session-level `time_min` to the exercise unsplit (not zero, not divided) — a row answers "how much workout time happened on days including this exercise," not a strict per-exercise allocation, so a Minutes total can exceed actual hours trained once exercises overlap in the same session; that's intentional. Row labels resolve to the exercise's `display_name`, falling back to a humanized slug for an orphaned/deleted exercise. The totals row sums over the virtualized per-slug entries in pivot mode, not the raw session notes (a literal `sets`/`time_min` key doesn't exist there). Result: a pre-migration chart with `groupBy: exercise` and generic `sum(sets)`/`sum(reps)`/`sum(time_min)` columns works unchanged except for `folder: Data/Workouts` in place of the legacy folder.

**Files changed:** `src/utils.ts` (`getExerciseDisplayName`, `parseWikilink`, `resolveWikilinkTarget`), `src/routineTracker.ts` (display-name/wikilink-target resolution throughout: exercise form, `FileSuggestModal`, `logOneExercise`, `findLastLoggedSet`/`findLastLoggedCardio`, routine line parse/format, session heading write/parse), `src/circuitCallerExport.ts` (updated `parseRoutineBody` call signature), `src/exerciseMigration.ts` (new), `src/charts/tableChart.ts` (auto-pivot), `src/renderer.ts` (thread `app`/`settings` into `renderTableChart`), `src/main.ts` (new command), `Documentation.md`.

---

### v1.7.4 — Total Time & Exercise Mode (Phase 5)

Fixed a real bug: logging a recumbent-bike exercise showed the strength set-logging flow instead of cardio, because `routineTracker.ts` branched strength vs. cardio on the exercise note's `category` field while the vault actually uses `mode: Cardio` / `mode: Strength`. Rather than editing every exercise note, the plugin now matches the vault.

**Change 1 — exercise-note `category` renamed to `mode`.** Exercise-note scope only — routine notes' own, unrelated `category` field (free-text grouping like "Upper Body") is untouched. `isCardioCategory` renamed to `isCardioMode`, reads `fm.mode` everywhere it's called (`logOneExercise`, `parseWorkoutLogBody`, the exercise form's metric-visibility toggle). Renamed every internal variable in the exercise-form code path too — `ExerciseFormModal`, `ExerciseFormResult`, `loadExerciseForEdit`, `buildExerciseContent`, `createEditExercise` — not just the YAML key. Label reads "Mode (optional)". No migration, no backward-compat read of the old `category` key on exercise notes — nothing in the vault still uses it there.

**Change 2 — one `time_min` field replaces `total_duration_min`.** A single optional, hand-typed whole-session minutes value — covers warmup, rest between sets, everything per-exercise numbers don't capture. Prompted once at the end of Log workout (after "Finish workout," a new `TotalTimeModal`, same skippable shape as the existing heart-rate modal) and editable afterward via Edit workout log's new "Edit total time" action. Omitted from frontmatter entirely when skipped (never `0` or blank). Applies to every workout type — strength, cardio, or mixed — and is independent of the existing per-exercise `<slug>_duration_min` cardio field, which is untouched.

`time_min` is session state, not derived from the exercise list, so — like `routineName` and `creation_date` — it has to be threaded through explicitly on every `writeWorkoutLogContent` call (both Log workout and Edit workout log) or a resave would silently drop it. `WorkoutTotals` and the finish notice no longer reference `totalDurationMin`; the notice now reports `time_min` when entered and drops that clause entirely when skipped.

**Files changed:** `src/routineTracker.ts` (`isCardioMode` rename, `mode` field throughout the exercise-note code paths, `TotalTimeModal`, `writeWorkoutLogContent`/`saveWorkoutLog`/`logWorkout`/`EditWorkoutLogModal` threading `timeMin`, removed the now-dead `isCardioLog` helper), `Documentation.md`.

---

### v1.7.3 — Circuit Caller Export (Phase 4)

New command **"Export routine (Circuit Caller)"** — exports one routine at a time as a Circuit Caller-compatible backup JSON file. One-way, one-off export: nothing is imported back, nothing is saved into Tracker Pro's own data, and the file is never written into the vault.

- Fuzzy-picks a routine and reads its exercise list using the existing `parseRoutineBody` parser from Phase 1 (now exported from `routineTracker.ts`, along with `ExerciseTarget`) — names only, target sets/rep-range dropped.
- Timing is a fixed assumption hardcoded into the export logic: every exercise gets `workSeconds: 60, restSeconds: 30`. Not stored on the routine note, not prompted for, not configurable.
- `settings` block (voice/countdown/beeps/vibrate/etc.) is a fixed object, identical on every export. `rounds` is always `1`. `prepOverrideSeconds` is always `-1` (defers to Circuit Caller's own global prep-time setting). `exportedAt` is fresh epoch milliseconds each time.
- **Save destination is asked every time, platform-branched, never the vault:**
  - Desktop: Electron's native "Save As" dialog (`electron.remote.dialog.showSaveDialog`), default filename `{Routine Name}.json`.
  - Mobile: OS share sheet via a file-attached Web Share API call (`navigator.share`). If unsupported on-device, shows an error directing the user to export from desktop instead — explicitly does **not** silently fall back to a vault-saved file.
- Filename: sanitized routine name + `.json` on both platforms.

**Files changed:** `src/circuitCallerExport.ts` (new), `src/routineTracker.ts` (exported `parseRoutineBody`/`ExerciseTarget`, no logic changes), `src/main.ts` (new command), `Documentation.md`.

---

### v1.7.2 — Workout Log Editor (Phase 3)

New command **"Edit workout log"** — fixes mistakes in an already-saved session note (`Data/Workouts`), same shape as the existing Edit meal log. Does not touch routine definitions (already editable via Create/edit routine) or legacy `Data/Exercise Notes` cardio.

**Flow:** always asks which session first — fuzzy picker over the 30 most recently modified workout notes, newest first (no default-to-today, unlike Edit meal log, since this is one note per session rather than per day). Loads the note, tags each exercise strength/cardio by reading the **current** category off its source exercise note (falls back to body-shape sniffing if that note was deleted/recategorized since logging, so editing an orphaned entry doesn't hard-fail). Shows a per-exercise summary with three actions:

- **Edit an exercise** — strength: change equipment, change/add/remove a set. Cardio: change equipment, edit duration/distance (pace or speed recomputes automatically from `cardio_metric`, never edited directly), edit heart rate (optional, skippable).
- **Add an exercise** — reuses `logOneExercise` (the exact same per-exercise flow Log workout already uses) so search/equipment/logging behavior is identical, not reimplemented.
- **Remove an exercise** — deletes its `##` heading/body and every `<slug>_*` rollup field it wrote.

**Save and recalculate** is a full rewrite, not a patch: refactored the rollup+body write logic out of `saveWorkoutLog` into a shared `writeWorkoutLogContent(app, settings, file, routineName, exercises, notesLines)`, called by both Log workout (new file) and Edit workout log (existing file) — guarantees identical, always-fresh rollup computation with no drift between the two commands. Frontmatter is cleared (except `creation_date`) and rebuilt from the current exercise list every save, so a removed exercise can't leave stale fields behind. Appends `- {date} — Log recalculated` to `## Notes`, same pattern as Edit meal log.

**Version note:** manifest.json on master had been manually corrected to `1.7.1` (independent of this branch, to match the actually-published version), while package.json had drifted to `1.8.0`. This release bumps forward from the corrected `1.7.1` baseline to `1.7.2` — matching the spec's original instruction exactly — and syncs package.json to the same value.

**Files changed:** `src/routineTracker.ts` (`writeWorkoutLogContent` refactor, `parseWorkoutLogBody`, `parseNotesLines`, `SetEditModal`, `CardioFieldsEditModal`, `HeartRateEditModal`, `EditWorkoutLogModal`, `getRecentWorkoutLogFiles`, `editWorkoutLog`), `src/main.ts` (new command), `Documentation.md`.

---

### v1.8.0 — Unified Exercise Log (Phase 2): Cardio Joins Workout Routines

Folds cardio (walking, riding, etc.) into the Phase 1 Routine Tracking system as a `category: Cardio` exercise type, logged through the same **Log workout** command. Replaces the Templater/QuickAdd cardio template going forward. Historical cardio notes in `Data/Exercise Notes` are **not migrated** — left exactly as they are; Achievements' Exercise Streak (which scans that folder) is unaffected and out of scope for this pass.

**Exercise note — new field:** optional `cardio_metric` (`Pace` | `Speed`), read only when `category: Cardio`. `default_equipment` (Phase 1) now defaults to include `Outdoor`/`Treadmill` alongside the strength equipment types.

**Log workout — cardio branch:** confirm equipment → one entry (duration in minutes + distance, no interval loop — cardio is always a single continuous effort) → optional avg/peak heart rate (BPM, new — RPE deliberately excluded, no real number behind it) → pace or speed auto-computed from `cardio_metric` and written to the session note. Pace formatting reuses the existing `parseTimeToSeconds`/`formatSecondsAsTime` mm:ss utilities (from the v1.6.7 pace-charting work) rather than reimplementing.

**Pace/speed formulas:**
```
pace  = formatSecondsAsTime((durationMin * 60) / distance)   // e.g. 35 min / 3.0 km → 11:40
speed = (distance * 60 / durationMin).toFixed(1)              // e.g. 30 min / 8.5 km → 17.0
```

**Session note rollups — cardio:** `<slug>_duration_min`, `<slug>_distance`, `<slug>_pace` (only if metric is Pace) or `<slug>_speed` (only if Speed), `<slug>_avg_hr`/`<slug>_peak_hr` (only when entered), `<slug>_equipment`. New `total_duration_min` alongside the existing `total_sets`/`total_volume` — always written (0 when a session has none of that kind). A session can freely mix strength and cardio exercises. Body: single line per cardio exercise (`- {duration} min · {distance} {distanceUnit} · Pace {pace}/{distanceUnit}` or `Speed {speed} {distanceUnit}/h`, with HR appended only when entered) — no per-set bullets.

**Log workout gets a true ad hoc entry point:** first step is now a choice — "Pick a routine" (Phase 1 flow, unchanged) or "Log without a routine" (search the exercise database directly, log one exercise at a time, reusing the existing "add an exercise" loop as the whole flow). Both paths converge on the same finish/save step. An ad hoc session omits the `routine:` frontmatter key entirely rather than writing an empty value. No structural change to the routine creator — cardio exercises are added to routines exactly like strength ones, target hints stay freeform text (e.g. "20 min" fits the existing target-rep-range field).

**New setting:** `distanceUnit` (display-only, default `km`), alongside the existing `weightUnit`.

**Explicitly out of scope:** RPE, unit conversion (km↔mi), migrating historical cardio notes, editing the Templater/QuickAdd config (manual step for the user), interval-style multiple cardio entries per exercise, Achievements/Exercise Streak changes.

**Files changed:** `src/routineTracker.ts` (discriminated `LoggedExercise` union, `CardioEntryModal`, `findLastLoggedCardio`, generalized `EquipmentModal` hint mechanism, cardio branch in `logOneExercise`/`saveWorkoutLog`, ad hoc entry point in `logWorkout`, `cardio_metric` field in the exercise form), `src/settings.ts` (`distanceUnit`, expanded `equipmentTypes` default), `Documentation.md`.

---

### v1.7.0 — Workout Routine Tracking

New strength-routine logging system: define a routine once, then log a session against it exercise-by-exercise with per-set weight/reps. Cardio logging (Exercise Notes / Achievements) is untouched — no changes to that code path.

**New vault structure:**
- `Data/Exercises/` — one note per exercise (optional `category`, `default_equipment`, plain-text body description).
- `Data/Routines/` — one note per routine (optional `category`, `## Exercises` ordered list: `N. [[Exercise Name]] — target sets × rep range`, suffix optional).
- `Data/Workouts/{{DATE:YYYY}}/{{DATE:YYYY-MM}}/` — one note per **session** (not per day), filename `WL-{{DATE:YYYY-MM-DD}}-{{DATE:HHmmss}}` for guaranteed uniqueness.

**Session note rollups** (per exercise, keyed by `slugify(name)`, in logged order): `<slug>_sets`, `<slug>_reps`, `<slug>_top_weight`, `<slug>_volume`, `<slug>_equipment`, followed by `total_sets` and `total_volume`. Body: one `## {Exercise Name} — {Equipment}` heading per exercise with `- Set N: {weight} {weightUnit} × {reps}` bullets, trailing empty `## Notes`. Frontmatter key order enforced via `processFrontMatter` + `vault.read`/`vault.modify` (same pattern as `mealLogger.ts`'s `recalcAndSave`).

**New commands** (`src/routineTracker.ts`):
- **Create/edit exercise** — fuzzy search + "+ Create new exercise", form for name/category/description/default equipment.
- **Create/edit routine** — pick/create, loop to search-and-add exercises (optional target sets × rep range), reorder, remove, done → full rewrite of the routine note.
- **Log workout** — pick a routine, then per exercise: confirm equipment (prefilled from `default_equipment`, dropdown over `equipmentTypes`) with a live "last-logged top weight × reps for that equipment" hint pulled from past session bodies; log sets in a loop (add set / next exercise / skip exercise); optionally log extra exercises not in the routine; finish to write the session note.

**New `slugify()` utility** (`src/utils.ts`): lowercase, trim, collapse non-alphanumeric runs to `_`, strip leading/trailing `_`. Used for rollup keys and equipment/exercise lookups.

**New settings section** ("Workout Routines", placed after Vitamins): `exerciseFolder`, `routineFolder`, `workoutLogFolder`, `workoutLogFilename`, `weightUnit` (display-only, no conversion), `equipmentTypes` (drag-reorder list, same UI pattern as `vitaminPeriods`).

**Chart compatibility:** no new chart type — existing `line`/`bar`/`table`/`summary` blocks read the rollup properties directly (e.g. `properties: [bench_press_top_weight]`, or `type: table / groupBy: routine / columns: [count, sum(total_volume)]`).

**Explicitly out of scope:** lb/kg conversion, RPE tracking, cross-equipment weight suggestions, an "Edit workout log" command (fast-follow), and Achievements/Exercise Streak changes.

**Files changed:** `src/utils.ts` (`slugify`), `src/settings.ts` (Workout Routines section), `src/routineTracker.ts` (new), `src/main.ts` (3 new commands), `Documentation.md`.

---

### v1.6.7 — `mm:ss` Time-Value Support (Auto-Detected)

Fixed silent data corruption on `mm:ss` frontmatter properties (e.g. `pace: 12:34`). `parseFloat("12:34")` was returning `12` — seconds were dropped entirely.

**Changes:**

- `src/utils.ts`: New `parseTimeToSeconds(raw)` and `formatSecondsAsTime(totalSeconds)` helpers. Detection regex: `/^\d{1,3}:\d{2}$/`.
- `src/types.ts`: Added `isTimeFormat?: boolean` to `SeriesData`.
- `src/dataCollector.ts`: `extractNumericValue()` tries `parseTimeToSeconds` before `parseFloat`. `buildSeriesData()` detects time format from raw frontmatter values and sets `isTimeFormat` on each series.
- `src/charts/lineBarChart.ts` (line and bar only): `resolveAxisBound()` helper accepts mm:ss strings for `yAxis.min`/`max` when time format is detected. Y-axis ticks and tooltips formatted via `formatSecondsAsTime()` when `series.some(s => s.isTimeFormat)`.

Auto-detection: a property is treated as time format if any sampled entry has a raw string value matching the pattern. No config flag needed.

Known limitation: same-date note bucketing sums values before aggregation (existing behavior). Two runs on the same day will sum paces rather than average them — not changed as part of this fix.

---

### v1.6.6 — `{{targetIntake()}}` + Weight Endpoint Averaging

**`{{targetIntake(calProp, ratePerWeek)}}`** — forward-looking daily calorie target based on real TDEE and a chosen rate of loss/gain:

```
dailyDeficitTarget = ratePerWeek × 3500 / 7
targetIntake       = tdee − dailyDeficitTarget
```

`ratePerWeek` is signed (positive = loss, 0 = maintenance, negative = surplus). Shares the existing `tdeeCache` — `calcTdeeCore` is not re-run for the same `calProp`. Same `N/A` fallback. Multiple calls with different rates in one template each get their own regex match; only one vault scan per `calProp` regardless.

**Weight endpoint averaging** — `calcTdeeCore` now smooths each anchor by averaging a small cluster of readings instead of using a single day's value. This reduces distortion from water/sodium/food-volume swings that can move a single day's weigh-in several pounds. Config:

```yaml
tdee:
  avgWindowDays: 3   # optional, default 3
```

- **Early cluster**: all weight readings from the early anchor date through `+avgWindowDays` days.
- **Late cluster**: all weight readings from `−avgWindowDays` days through the late anchor date.
- `daysInPeriod` = gap between anchor dates — unchanged by the window.
- If a reading falls in both clusters it contributes to each average independently.
- A cluster of one (single reading near an anchor) averages to that value — no special-casing.

`{{targetIntake()}}` automatically benefits from the smoothed TDEE since it reads the same cache.

**Files changed:** `src/types.ts` (`avgWindowDays` on `tdee` config), `src/charts/summaryChart.ts` (averaging logic in `calcTdeeCore`, `ensureTdee` helper, `targetIntake` pre-pass), `Documentation.md`.

---

### v1.6.5 — `{{tdeeCalories(calProp)}}` Summary Template Function

New companion to `{{tdee()}}` and `{{deficit()}}` for `type: summary` blocks.

`tdeeCalories = tdee − deficit`, which algebraically equals the period average calorie intake (`avgCal`). Renders as a whole number rather than one decimal place. Intended for grouping alongside the TDEE/deficit stats in a template — e.g.:

```
Est. TDEE: {{tdee(cal_total)}}
Est. deficit: {{deficit(cal_total)}}
Est. intake: {{tdeeCalories(cal_total)}}
```

Reuses the existing `tdeeCache` in `renderSummaryChart` — `calcTdeeCore` is not called a third time for the same `calProp`. Same `N/A` fallback when fewer than two weight readings are available.

**Files changed:** `src/charts/summaryChart.ts` (regex extended, new branch in callback), `Documentation.md`.

---

### v1.6.4 — TDEE & Deficit Summary Template Functions

New template functions for `type: summary` blocks:

- **`{{tdee(calProp)}}`** — Estimates TDEE (kcal) by combining average calorie intake with measured weight change over the display range. Algorithm: `tdee = avgCal − (weightChange_lbs × 3500 / daysInPeriod)`. Returns `N/A` if fewer than two weight readings are available.
- **`{{deficit(calProp)}}`** — Estimated daily calorie deficit (`tdee − avgCal`). Positive = deficit, negative = surplus. Returns `N/A` when TDEE data is unavailable.

Weight readings are pulled from the Achievements daily-notes folder (`weight` property) by default. Override with an optional `tdee:` config block inside the tracker code fence:

```yaml
tdee:
  weightFolder: Data/Daily Notes   # optional
  weightProperty: weight           # optional — default: "weight"
```

Weight lookups prefer readings within the chart's display date range (first vs last). Falls back to the two most-recent readings vault-wide if fewer than two fall in range.

**Files changed:** `src/types.ts` (new `tdee` field on `TrackerConfig`), `src/charts/summaryChart.ts` (new `calcTdeeCore`, new imports, `renderSummaryChart` now accepts `app` and `settings`), `src/renderer.ts` (passes `app` and `settings` to `renderSummaryChart`), `Documentation.md`.

---

### v1.6.3 — Fix: Normalize Recipe Ingredients — core extraction and packaged-quantity cleanup

Three bugs in `src/recipeNormalizer.ts` identified against a real recipe (White Chicken Chili):

**Bug 1 — Recipe adjectives not stripped.** `medium yellow onion`, `frozen corn`, `low-sodium chicken broth` wouldn't match vault notes named `Yellow Onion`, `Corn`, `Chicken Broth`. Added `RECIPE_ADJECTIVES` list and a second leading-strip pass in `extractCore()` (adjective discarded, not added to `leading`).

**Bug 2 — Container word leftover after packaged-quantity collapse.** `3 (15-oz.) cans green chiles` → `45 oz cans green chiles` → core was `cans green chiles`. Added `CONTAINER_WORDS` set; case (c) now strips a leading container word from `rest` before assigning `foodDesc`.

**Bug 3 — Missing trailing phrases.** `, cut into thirds`, `, divided`, `, at room temperature`, `, thawed` etc. weren't in `TRAILING_PHRASES`, so they stuck to the core name. Expanded `TRAILING_PHRASES` with the common missing patterns.

---

### v1.6.2 — Fix: Normalize Recipe Ingredients ignoring checklist lines

The bullet-stripping regex in `normalizeRecipeIngredients` only consumed `- ` / `* `, leaving the checkbox marker `[ ] ` attached to the content. This caused `classifyContent()` to see `[ ] 3/4 c. ...` (starts with `[`, not a digit), routing every checklist-format line to case (b) — no normalization, no linking. Fixed by extending the regex to optionally consume the checkbox as part of the bullet prefix:

```
/^(\s*[-*]\s+(?:\[[ xX]\]\s+)?)(.*)/
```

The checkbox is written back untouched in Step 7, same as the bullet character always was.

---

### v1.6.1 — Normalize Recipe Ingredients

New command: **Normalize Recipe Ingredients** (id: `normalize-recipe-ingredients`).

Cleans up freshly web-clipped ingredient lists in two phases: quantity/unit normalization then wikilink insertion. Nothing is written until every modal is resolved — cancel at any point and the note is untouched.

**Phase 1 — Quantity & unit normalization:**
- Converts vulgar/Unicode fractions (`3/4`, `¾`) to decimals (`0.75`)
- Strips trailing periods from unit abbreviations (`tbsp.` → `tbsp`, `oz.` → `oz`)
- Collapses packaged-quantity notation (`4 (6-oz.) cans` → `24 oz cans`)
- Normalizes unit names to canonical form via the shared `UNIT_CANONICAL` map (now in `utils.ts`)
- Ambiguous lines (ranges, unrecognized patterns) are queued for a sequential review modal

**Phase 2 — Wikilink insertion:**
- Lines already containing `[[` are skipped
- Common seasonings (salt, pepper, dried herbs, explicit list) are skipped — no link attempted, no Notes entry
- Each remaining ingredient's "core name" is extracted by stripping leading prep-action words and trailing comma-clauses/parentheticals/serving notes
- Exact case-insensitive match against food notes (`settings.foodFolder`) and recipes (`settings.recipeFolder`): auto-linked, no modal
- Fuzzy match (Obsidian `prepareFuzzySearch`, top 5, score > -1): shown in a modal with candidate buttons and an editable search box
- No match at all: added directly to `## Notes` as "needs creation"
- Modal also offers "Create new food note" (→ Notes) and "Leave unlinked"

**Link format:**
- Exact casing/plurality match: `[[Title]]`
- Otherwise: `[[Title|core-as-written]]`

**Utility additions (`src/utils.ts`):**
- `UNIT_CANONICAL` map relocated from `mealLogger.ts` and extended with `c`, `pint`/`pt`, `quart`/`qt` aliases
- `normalizeUnit()`, `fmt2()` relocated from `mealLogger.ts`
- New `findSectionRange(lines, header)` — shared section-range lookup
- New `getCandidateFiles(app, settings)` — enumerates food + recipe note pool

**`src/mealLogger.ts`:** local `UNIT_CANONICAL` / `normalizeUnit` / `fmt2` removed; imported from `utils` instead (no behavior change).

**`src/recipeCalculator.ts`:** `extractSection` now delegates to `findSectionRange`; `Skipped` interface and `applyNotesSection` exported for reuse.

---

### v1.6.0 — Achievements Block

New `type: achievements` inline block for tracking gamified progress badges.

**Codeblock:**
```yaml
type: achievements
```

No additional configuration in the codeblock — all data sources and targets are read from plugin settings.

**Six badge categories:**

| Category | Tiers | Data source |
|---|---|---|
| Weight Milestones | every 20 lbs from start → goal | `weight` property in daily notes |
| Tracked Day Streaks | 3, 7, 14, 30, 60, 90 days | food log notes (consecutive days) |
| Exercise Streaks | 3, 7, 14, 21, 30 days | exercise notes (consecutive days) |
| Calorie Goal | 7, 14, 30, 60, 90 days | `cal_total` ≤ calorie goal setting |
| Macro Balance | 7, 14, 30, 60, 90 days | Atwater % within ±tolerance of targets |
| Resistance Wins | 1, 5, 10, 25, 50 wins | `resistance_wins` summed across WN notes |

**New Achievements settings section (11 fields):**
- Daily notes folder, food log folder, exercise notes folder, weight loss notes folder
- Starting weight, goal weight, calorie goal
- Protein %, fat %, carb % targets, macro tolerance %

**`resistance_wins` frontmatter property:** Optional integer on any weight loss note. The achievements block sums this value across all notes in the WN folder. Add `resistance_wins: 1` (or higher) to log wins.

**Macro balance formula:** Atwater — `(macro_g × factor / cal_total) × 100` where factors are protein × 4, fat × 9, carbs × 4. A day qualifies if all three macros are within `±achievementsMacroTolerance` percentage points of their targets.

**Rendering:** Each badge shows a circular icon (accent color when unlocked, grey lock when locked), the tier label, and either the earned date or a hint for locked badges.

**Auto-refresh:** re-renders on any file change in any of the four configured folders.

**New file:** `src/charts/achievementsChart.ts`

---

### v1.5.9 — Macro Percent Fields in Nutrition Commands

Both nutrition commands in `src/recipeCalculator.ts` now calculate and write
`carbs_percent`, `fat_percent`, and `protein_percent` to frontmatter after
every run.

**Formula:** Atwater macro-calorie basis — `Math.round((macro × factor) / totalCal × 100)`
where factors are carbs × 4, fat × 9, protein × 4.

**Key order enforced:** Percent fields are written via raw string manipulation
(not `processFrontMatter`) to guarantee they appear immediately after `protein`
in frontmatter.

New private helper `applyMacroPercents(content, carbs, fat, protein)` added to
`src/recipeCalculator.ts` — removes any existing percent lines then inserts the
three fields after the last macro line (carbs/fat/protein), regardless of macro
key order in the note.

**Affected commands:**
- Tracker Pro: Calculate Recipe Nutrition
- Tracker Pro: Recalculate Food Note Calories

---

### v1.5.8 — Fix Vitamins Double-Write on Second Log Action

Fixed a bug where logging a second vitamin period (e.g. Evening after Morning was already logged) caused the first period's entries to appear twice in the `## Vitamins` block of the food log.

**Root cause:** The regex `/^## Vitamins[\s\S]*?(?=\n##\s|\n---\s*$|$)/m` had the `m` flag active, which makes `$` match end-of-line rather than end-of-string. The lazy `[\s\S]*?` would stop at the very first newline after `## Vitamins`, leaving the old `### Morning` / `### Evening` content in place. The new merged block was then inserted after only the header line, producing a duplicate.

**Fix:** Replaced the regex-based replacement with a new `replaceVitaminsBlock()` helper in `src/vitaminTracker.ts` that uses string-index slicing:
- `content.search(/^## Vitamins/m)` locates the block start
- A second search on the remainder (`/\n## /`) finds the next `##` section (e.g. `## Notes`)
- `before` / `after` slices are computed exactly, then reassembled with the new block in between
- If no `## Vitamins` block exists, appends as before

The `m`-flag pitfall is entirely avoided. `## Notes` and all subsequent content are preserved verbatim.

---

### v1.5.7 — Preserve Unknown Sections on Edit Meal Log Save

Fixed a bug where "Save and recalculate" in the Edit Meal Log modal silently
discarded any `##` section it did not own — in practice, the `## Vitamins`
block written by the vitamin tracker was wiped out on every save.

**Changes to `src/mealLogger.ts`:**
- Added `OWNED_HEADINGS` constant (meal types + Vitamins + Notes)
- Added `parseUnknownSections(body)` — collects every unowned `##` section verbatim, in document order
- Added `parseVitaminsSectionRaw(body)` — extracts the raw `## Vitamins` block as a string, or null if absent
- `EditMealLogModal` now captures `unknownSections` and `vitaminsRaw` in `loadFile` and passes them to `recalcAndSave`
- `recalcAndSave` body rebuild order: meal sections → unknown sections → Vitamins (if present) → Notes

---

### v1.5.6 — Vitamin Tracker Per-Period Last Taken

Fixed a bug where a `Morning/Evening` vitamin became fully pre-deselected after logging only one period, because `vitamin_last_taken` was a single shared date field.

**`vitamin_last_taken` is now a per-period YAML map:**
```yaml
vitamin_last_taken:
  Morning: "2026-06-03"
  Evening: ""
```

- Each period key is set to `YYYY-MM-DD` when that period is logged; other periods are unchanged
- Empty string `""` means not yet taken for that period
- Pre-deselect in the checklist is now per-period: a `Morning/Evening` vitamin can have Morning greyed out while Evening stays selectable

**Transparent scalar migration:** existing notes with the old `vitamin_last_taken: 2026-06-03` scalar format are migrated automatically in the background on first render — treated in memory as if every period was last taken on that date, then rewritten to the new map format via `vault.process`. No user action required; migration is non-destructive and silent.

---

### v1.5.5 — Vitamin Tracker Display Fixes

Four targeted improvements to the vitamin tracker.

**Separator change:** em dash `—` replaced with plain hyphen `-` in checklist row labels and food log lines. Old logs (written with `—`) continue to parse correctly.

**`vitaminPeriods` setting:** new `string[]` setting (default `["Morning", "Evening"]`) controls which time-of-day sections appear and in what order. Configured via a drag-to-reorder list in plugin settings — drag handle `⠿`, delete button `✕` per item, plus an Add field at the bottom.

**Dynamic checklist sections:** vitamins are grouped by period section (filtered and sorted by `vitaminPeriods`). `vitamin_time` values with `/` separators (e.g. `Morning/Evening`) cause the vitamin to appear in each matching section with an independent checkbox. Already-taken vitamins are pre-deselected across all sections.

**Dynamic food log sections:** the `## Vitamins` block in the food log uses `vitaminPeriods` order for `### Section` headings. Re-logging the same day merges by section name (not hardcoded keys). Vitamins with multiple time values appear under each matching heading.

**Vitamin name links:** each name in the checklist is now a clickable internal link to the vitamin note.

---

### v1.5.4 — Vitamin Tracker Inline Block

New `type: vitamins` inline block for tracking daily vitamin intake.

**Codeblock:**
```yaml
type: vitamins
```

**Rendering:**
- Checklist of all active vitamins (`vitamin_active: true`), sorted alphabetically by `vitamin_name`
- Each row: `Vitamin Name — {dose} {form}, {dose_unit}`
- Pre-deselects vitamins already taken today (based on `vitamin_last_taken`)
- **Select All / Deselect All** toggle at the top; already-taken vitamins are never affected by this toggle
- Two buttons at the bottom: **Log Vitamins** and **Resupply**

**Log Vitamins:**
- Decrements `vitamin_on_hand` by dose amount (floored at 0), sets `vitamin_last_taken` to today
- Split-dose vitamins (`vitamin_dose: "1/1"`) deduct 2 from on-hand total, display as 1 per section
- Appends/replaces a `## Vitamins` section in today's food log note (creates the log if it doesn't exist)
- Merge logic: if vitamins were already logged today, existing and new entries are combined by name per section (no duplicates)
- Section format:
  ```markdown
  ## Vitamins

  ### Morning
  - Omega-3 — 1 Softgel, 1000 mg

  ### Evening
  - Magnesium — 1 Veggie capsules, 180 mg
  ```

**Resupply (4-step flow):**
1. Fuzzy-pick an active vitamin
2. "Same bottle?" modal — confirms current count and brand
3. If different: new bottle modal with editable brand and quantity fields
4. Adds bottle count to `vitamin_on_hand`; updates `vitamin_brand` / `vitamin_count` if changed

**Auto-refresh:** re-renders when any file in `vitaminsFolder` changes via `metadataCache.on("changed")`

**New setting:** `vitaminsFolder` (default: `Data/Vitamins`) — inserted between Reading Challenge and Tracker Pro General Settings

**Vitamin note schema:**
```
vitamin_active:      true | false
vitamin_name:        string
vitamin_brand:       string
vitamin_count:       number
vitamin_on_hand:     number
vitamin_dose:        string  (e.g. "1" or "1/1" for morning+evening)
vitamin_dose_unit:   string  (e.g. "1000 mg")
vitamin_form:        string  (e.g. "Softgel")
vitamin_time:        string  ("Morning", "Evening", or "Morning/Evening")
vitamin_last_taken:  string  (YYYY-MM-DD)
```

---

### v1.5.3 — Unit Pluralization Bug Fix

- Fixed: Units were incorrectly pluralized in meal log notes (e.g. `cupses`, `sliceses`)
- Fixed: Singular quantities (e.g. `1 slice`) were incorrectly pluralized
- Fixed: Unit matching now normalizes variants (`cup`/`cups`, `slice`/`slices`, `oz`/`ounce`, etc.) so recipe/log lookups succeed regardless of which form is stored in the food note
- Replaced `pluralizeUnit` / `NEVER_PLURALIZE` / `IRREGULAR_PLURALS` with `UNIT_CANONICAL` map + `normalizeUnit()` function
- Display strings use the unit exactly as stored in the food note frontmatter — no modification

---

### v1.5.2 — Summary Chart Named-Argument Template Functions

Extended the summary template engine with named-argument function syntax.

**Single-arg named aggregates** — operate on one named property (must be in `properties`):
- `{{mean(propName)}}` — average daily value for that property
- `{{sum(propName)}}` — total sum
- `{{max(propName)}}` — highest single-day value
- `{{min(propName)}}` — lowest single-day value

**Two-arg macro percentage functions** — Atwater formula:
- `{{carbPct(macroProp, calProp)}}` — carb caloric percentage (× 4)
- `{{fatPct(macroProp, calProp)}}` — fat caloric percentage (× 9)
- `{{proteinPct(macroProp, calProp)}}` — protein caloric percentage (× 4)

Unrecognised property names render as `?`. All existing no-arg functions unchanged. The `twoArgResolver` in `renderSummaryChart` is extended to handle the three macro pct functions alongside `meanDateDiff`. `applyTemplate` gains a fifth `series` parameter used by the new single-arg pass.

---

### v1.5.1 — Summary Template Variables: `{{first()}}`, `{{latest()}}`, `{{diffFrom(N)}}`, `{{latestTo(N)}}`

Four new variables for the `summary` chart type:

- **`{{first()}}`** — earliest non-null value in the summary date range (rounded to 1 decimal)
- **`{{latest()}}`** — most recent non-null value in the summary date range (rounded to 1 decimal)
- **`{{diffFrom(N)}}`** — `N − latest()`, useful for tracking loss from a fixed starting point (e.g. `{{diffFrom(366.2)}}` for lbs lost from starting weight)
- **`{{latestTo(N)}}`** — `latest() − N`, useful for distance remaining to a goal (e.g. `{{latestTo(180)}}` for lbs to goal)

`applyTemplate` extended with a one-numeric-argument pass (`{{name(N)}}`) between the existing two-arg and zero-arg passes — `meanDateDiff` and all existing variables continue to work unchanged.

`Dashboards/Weight Dashboard Test.md` added to the vault — gauge, summary, and line chart blocks targeting `Data/Daily Notes` weight property.

---

### v1.5.0 — Atwater Calorie Calculation + Recalculate Food Note Calories Command

**Atwater fix in `recipeCalculator.ts`** — calories are now always derived from accumulated macros rather than summed from food note calorie fields:

- The `totals.calories += ... * ratio` line is removed from the ingredient loop
- After the loop: `totals.calories = Math.round(totals.carbs * 4 + totals.fat * 9 + totals.protein * 4)`
- Frontmatter write-back: macros are rounded first, then `fm.calories = fm.carbs * 4 + fm.fat * 9 + fm.protein * 4` so the stored value is always exactly consistent with stored macros

**ServingsModal display fix (two patches)** — the live cal/serving preview went through two rounds of correction to match the write-back exactly:
- Patch 1: switched from `totals.calories / s` to per-serving Atwater — still wrong due to rounding order
- Patch 2 (final): modal `update` now rounds each macro per serving first, *then* applies Atwater — identical arithmetic to the write-back, so preview and written `calories` always match:
  ```typescript
  const c = Math.round(this.totals.carbs   / s);
  const f = Math.round(this.totals.fat     / s);
  const p = Math.round(this.totals.protein / s);
  calDisplay.setText(`${c * 4 + f * 9 + p * 4} cal/serving`);
  ```

**New command: "Recalculate Food Note Calories"** (`recalcFoodNoteCalories` in `recipeCalculator.ts`) — on the active food note, reads `carbs`/`fat`/`protein` from frontmatter, computes Atwater calories, writes back `calories`, and shows a notice with the old → new values. Guards against missing frontmatter and all-zero macros.

---

### v1.4.9 — Summary Chart: `{{meanDateDiff()}}` and `{{meanHM()}}` Template Variables

Two new template variables for the `summary` chart type:

- **`{{meanDateDiff(field1, field2)}}`** — computes the average calendar days between two date frontmatter fields across all notes in scope, rounded to one decimal place. Handles both `"YYYY-MM-DD"` strings and js-yaml-coerced `Date` objects. Notes missing either field are skipped.
- **`{{meanHM()}}`** — formats the average of the `properties` values as hours and minutes (e.g. `6 hours, 33 minutes`). Input values are assumed to be in minutes. Falls back to `N minutes` only when the average is under 60 minutes.

Implementation:
- `calcMeanDateDiff(entries, field1, field2)` added to `summaryChart.ts`
- `calcMeanHM(series)` added to `summaryChart.ts`
- `applyTemplate` now handles two-argument `{{fn(arg1, arg2)}}` calls in addition to zero-argument `{{name()}}` calls
- `renderSummaryChart` signature extended with `entries: RawEntry[] = []`; `renderer.ts` passes `entries` through
- Documentation updated with variable table rows and usage example

---

### v1.4.8 — Recipe Calculator: `common_serving_unit` Same-Type Unit Conversion

**Bug 4 fix** — Case 1 in `calcRatio` now handles same-type unit conversion when the ingredient unit and `common_serving_unit` aren't an exact string match but are the same dimension:

- **Volume → volume**: converts both sides to ml via `VOL_TO_ML`, divides `amountInMl / (comSz × comUnitInMl)`. Example: `1 tbsp` with `common_serving_unit: tsp, common_serving_size: 1` → 14.79 ml / 4.93 ml = 3 servings
- **Weight → weight**: same pattern via `WT_TO_G`
- Cross-type mismatches (volume ingredient vs weight common unit) fall through to the existing Cases 2–4 as before

---

### v1.4.7 — Recipe Calculator: Nothing Written Until Confirm

Fixed the write ordering so nothing is saved to the note until the user clicks **Confirm** in the servings modal:

- Skipped ingredients and frontmatter are now both written inside the modal callback — cancelling the modal leaves the note completely unchanged
- Skipped Notes write still uses the original `content` captured before the modal opens, so the Ingredients section remains byte-for-byte intact (Bug 3 from v1.4.8 preserved)
- The `resolved === 0` failure path (no modal) still writes skipped immediately since there is nothing to confirm or cancel

---

### v1.4.8 — Recipe Calculator: Skipped Ingredients & Ingredient Line Safety

Three bugs fixed in `src/recipeCalculator.ts`:

**Bug 1 — Checklist items without wiki-links silently dropped**
The previous `map(parseIngredientLine).filter()` chain returned null for checklist items with no `[[wiki-link]]`, and those items were silently discarded. Replaced with an explicit loop: any checklist line without a wiki-link is now pushed to `skipped` with reason `"no wiki-link"`, so lines like `3 floats of ghool` and `1 tbsp pepper` appear in the Notes section.

**Bug 2 — Skipped not written in the success path before early-exit**
Moved the skipped write to an unconditional block before the `resolved === 0` check, covering both the failure and success paths with a single write.

**Bug 3 — Ingredient line corruption risk from deferred Notes write**
The Notes write was previously inside the `ServingsModal` callback, executing after `processFrontMatter` had already modified the file. By moving the Notes write to use the original `content` read at command start (before any frontmatter change), the Ingredients section is guaranteed to be byte-for-byte identical to what was read — no reconstructed content, no post-`processFrontMatter` re-read.

---

### v1.4.7 — Settings Section Reorder

Reordered the plugin settings page sections to alphabetical order:

**New order:** Bills · Meal Logger · Reading Challenge · Tracker Pro General Settings

**Convention established:** any future settings sections must be inserted in
alphabetical order by heading name. This is documented in a comment block at
the top of the `display()` method in `src/settings.ts`.

The "Tracker Pro" section heading was renamed to **"Tracker Pro General Settings"**
to make its alphabetical position unambiguous.

---

### v1.4.6 — Recipe Calculator: Always Write Skipped Ingredients

Fixed an early-return bug where `resolved === 0` caused the command to exit before writing the skipped-ingredients Notes section. The user received "No matching food notes found" with no explanation of why each ingredient failed.

Now the skipped list is written to the note first, then the failure Notice is shown. The Notice text is also updated to inform the user to check the Notes section.

---

### v1.4.5 — Recipe Calculator Unit Matching Fixes

Two bugs in `src/recipeCalculator.ts` that caused "No matching food notes found" errors:

**Bug 1 — Pluralized named units not matching `common_serving_unit`**
Added `singularize()` helper and applied it to both sides of the Case 1 comparison in `calcRatio`. Ingredient lines written as `"2 packages"` or `"3 cans"` now correctly match food notes with `common_serving_unit: package` / `common_serving_unit: can`.

**Bug 2 — Spelled-out unit names not in conversion tables**
Added full English spellings to `VOL_TO_ML` (`teaspoon`, `teaspoons`, `tablespoon`, `tablespoons`) and `WT_TO_G` (`pound`, `pounds`). These were previously classified as `"named"` and failed conversion.

---

### v1.4.4 — Food Logging Modal Layout Fixes

CSS-only fixes for the food logging modal amount input row:

- **Desktop — dropdown text clipped**: reduced vertical padding on the unit `<select>` from `8px` to `0` (horizontal `10px` unchanged) so dropdown text is no longer obscured
- **Mobile — input row overflow**: added a `@media (max-width: 400px)` rule targeting `.tracker-pro-amount-input-row` that stacks the number input and unit dropdown vertically (full width each) on narrow screens

---

### v1.4.3 — Amount Auto-Convert on Unit Switch

When the unit dropdown is changed in the food logging modal, the amount field now automatically converts to the equivalent in the newly selected unit (rounded to 2 decimal places, trailing zeros trimmed):

- **Common → Measured**: `new_amount = (current_amount / common_serving_size) × serving_size`
- **Measured → Common**: `new_amount = (current_amount / serving_size) × common_serving_size`

Also fixed the Common serving info line: now correctly shows `(1 / common_serving_size) × calories` instead of the incorrect `(common_serving_size / serving_size) × calories`.

---

### v1.4.2 — Common Serving Support in Food Logging Modal

**Food notes now support `common_serving_size` / `common_serving_unit` fields**

When a food note has both `common_serving_size` and `common_serving_unit` frontmatter fields, the amount modal shows an enhanced UI:

- **Two info lines** listing the measured serving (in `serving_unit`) and the common serving (in `common_serving_unit`), each with its calorie count
- **Dual-unit input row**: a number field next to a `<select>` dropdown offering both the common unit and the measured unit
- **Default**: common unit is pre-selected; if re-editing an entry that was entered in the measured unit, the measured unit is pre-selected
- **Live calorie total** below the inputs, updated as amount or unit changes; the Add button is disabled when amount ≤ 0
- **Dual-unit display amount** written to the log line: `"2 eggs / 100 g"` (common first) or `"100 g / 2 eggs"` (measured first), depending on which unit was selected

**Pluralization helpers** (`pluralizeUnit`):
- Units in the `NEVER_PLURALIZE` set (g, kg, ml, oz, cup, tsp, etc.) are never modified
- Irregular plurals handled: leaf → leaves, loaf → loaves
- `-fe` endings → `-ves`; sibilant endings → `-es`; default → `-s`

**`multiplierFromDisplay` updated** to parse both halves of a dual-unit string and determine the multiplier from whichever unit appeared first (common or measured).

**`changeQuantity` in Edit Meal Log** updated to extract the current amount and unit from the first part of a dual-unit display, so re-opening the modal pre-fills the correct value and pre-selects the correct unit.

---

### v1.4.1 — Calculate Recipe Nutrition Command

**New command: `Calculate Recipe Nutrition`**
- Run from the command palette with a recipe note open
- Reads the `# Ingredients` section and resolves each `[[wiki-link]]` to a food or sub-recipe note
- Extracts amount and unit from each line; applies unit conversion (volume↔volume, weight↔weight) before calculating contribution
- Sub-recipes detected by `Recipe -` filename prefix; per-serving values multiplied by resolved serving ratio
- Shows a confirmation modal with a suggested serving count (≤350 cal/serving), editable with live cal/serving update
- Writes `calories`, `carbs`, `fat`, `protein` (per serving, rounded), and `servings` to frontmatter via `processFrontMatter`
- Appends a `## Notes` section listing any skipped ingredients with the skip reason (no note found, unit mismatch, not convertible, recipe missing fields)

**Unit conversion support:**
- Volume: tsp, tbsp, fl oz, cup, pint, quart, l, ml (all converted to ml for comparison)
- Weight: g, kg, oz, lb/lbs (all converted to g for comparison)
- Named/count units (jar, can, serving, piece, etc.) matched directly against `common_serving_unit` or `serving_unit`

---

### v1.4.0 — Interactive Date Range Selector

**`dateSelector: true` — interactive dropdown above any chart**
- Add `dateSelector: true` to any chart block and a date-range `<select>` renders above the chart
- Selecting a preset re-renders only the chart portion; the selector stays in place
- Choosing **Custom…** reveals two `<input type="date">` fields; updating either date re-renders immediately
- Works with all chart types that support `dateRange`

**New `dateRange` presets**
- `today` — start = today, end = today
- `last-week` — the previous full calendar week (Sunday → Saturday)
- `last-month` — the previous full calendar month (1st → last day)

**Dropdown options (in order):** Today · This Week · This Month · This Year · Last Week · Last Month · Last Year · Last 7 Days · Last 30 Days · Last 90 Days · Last 6 Months · Last 12 Months · All Time · Custom…

---

### v1.3.3 — Edit Meal Log works without an existing log

**Edit meal log — no log required**
- Previously showed "No food log found for today" and aborted if today's log didn't exist yet
- Now creates a blank log note automatically (zeroed frontmatter, all four meal sections) and opens the edit modal on it

---

### v1.3.2 — Summary `min()` + Reading Challenge inline

**`min()` template variable for summary charts**
- Adds `{{min()}}` alongside the existing `{{max()}}`, `{{mean()}}`, and `{{sum()}}` variables
- Returns the lowest non-null value across all series points in the date range

**Reading Challenge converted to inline block**
- `type: reading-challenge` now renders directly in a note as a `tracker-pro` code block — no command or modal needed
- Year selector is a `<select>` dropdown in the hero that re-renders in place
- Removed the **Tracker Pro: Reading Challenge** command (superseded by the inline block)
- Goals file uses `reading_goal_YYYY: N` number properties (one per year) instead of a nested map

---

### v1.1.1 — Meal Logger

The core meal logging feature was integrated from the handoff files.

**New command: `Log meal`**
- Fuzzy modal to pick meal type (Breakfast / Lunch / Dinner / Snacks)
- Loop: search food database or recipes, enter amount, add more items
- Foods: amount in the food's unit (oz, cup, etc.) — math: `amount / serving_size × nutrition`
- Recipes: number of servings — math: `servings × nutrition`
- On save: creates today's log note if it doesn't exist, or appends to the correct section if it does
- Daily log note path is templated: `mealLogFolder` and `mealLogFilename` support `{{DATE:FORMAT}}` tokens

**Four new settings fields:**
- `Meal log folder` — e.g. `Data/Food Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}`
- `Meal log filename` — e.g. `{{DATE:YYYY-MM-DD}}`
- `Food database folder` — e.g. `Data/Food`
- `Recipes folder` — e.g. `Data/Recipes`

**Daily log frontmatter schema** — 20 fields written automatically:
```
cal_total, protein_total, fat_total, carbs_total
cal_breakfast, protein_breakfast, fat_breakfast, carbs_breakfast
cal_lunch, protein_lunch, fat_lunch, carbs_lunch
cal_dinner, protein_dinner, fat_dinner, carbs_dinner
cal_snacks, protein_snacks, fat_snacks, carbs_snacks
```

---

### v1.1.2 — Meal Log Editing

Three editing features added to the meal logger.

**During logging — Remove last item**
While building a meal, a "Remove last item (Name)" option appears in the menu whenever the list isn't empty. Pops the last entry and loops back.

**New command: `Clear meal`**
- Pick meal type → confirm
- Zeroes its 8 frontmatter fields, removes all bullet lines from that section, recalculates all four `_total` fields

**New command: `Edit today's meal log`**
- Pick meal type → fuzzy-pick which logged item to remove
- Parses nutrition numbers directly from the log line
- Removes the line from the note body, subtracts from frontmatter, recalculates totals

Log line format:
```
- [[Peanut Butter]] (2 oz) — 220 cal | 14g protein | 8g fat | 0g carbs
- [[Recipe - Cup of Coffee]] (1 serving) — 45 cal | 0g protein | 2g fat | 5g carbs
```

---

### v1.1.3 — Table Wiki Link Fix

Table `groupBy` cells were rendering `[[Data/Exercises/Exercise-Walk.md|Walk]]` as raw text instead of a clickable link.

Fixed by adding `renderGroupByCell()`: detects `[[path|display]]` or `[[path]]` patterns and creates a proper Obsidian internal-link `<a>` element. Falls back to plain text for non-link values.

---

### v1.1.4 — Table Expression Arithmetic

Column values can now use arithmetic between aggregation calls, and a `&` suffix for display units.

```yaml
value: sum(carbs_breakfast) / sum(cal_breakfast) * 100
value: sum(cal_breakfast)&%
```

---

### v1.1.5 — Table Height Fix

The parser was defaulting `config.height = 300` for all chart types, and the renderer was applying it to everything except `summary`. Tables were getting a 300px container with a large empty space below the rows.

Fixed by excluding `table` type from the height assignment — tables now size to their content.

---

### v1.1.6 — Expression Engine Redesign

The column value expression system was fully redesigned.

**`&` is now a string concatenation operator** (like Excel/LibreOffice Calc):
```yaml
value: "I ate " & sum(cal_breakfast) & " calories today"
# → "I ate 380 calories today"
```

**Quoted string literals** — recommended standard for text parts:
```yaml
value: "Fat: " & sum(fat_breakfast * 9) / sum(cal_breakfast) * 100 & "% of cals"
```

**Bare text** also works — surrounding spaces are preserved:
```yaml
value: I ate & sum(cal_breakfast) & today
# → "I ate 380 today"
```

**Inner expressions in aggregation functions** — evaluated per-entry before aggregating:
```yaml
value: sum(fat_breakfast * 9)                                    # per entry: fat*9, then sum
value: mean(fat / cal * 100)                                     # per entry: fat/cal*100, then mean
value: sum(fat_breakfast * 9) / sum(cal_breakfast) * 100         # outer arithmetic
```

---

### v1.1.8 — Daily Table Chart

A new `type: daily-table` chart for per-day nutrition and meal logging.

**Two modes:**

**Summary mode** (no `rows:`) — one row per day, `{row}` = `"total"`:
```yaml
type: daily-table
folder: Food/Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}
dateRange: last-7-days
columns:
  - label: Calories
    value: sum(cal_{row})
  - label: Protein
    value: sum(protein_{row}) & "g"
```

**Expanded mode** (`rows:` defined) — one sub-row per meal per day, date shown only on the first visible row:
```yaml
type: daily-table
folder: Food/Logs/{{DATE:YYYY}}/{{DATE:YYYY-MM}}
dateRange: last-7-days
rows:
  - Breakfast
  - Lunch
  - Dinner
  - Snacks
totalRow: Daily Total
showEmptyRows: false
dateFormat: MM/DD/YY
columns:
  - label: Calories
    value: sum(cal_{row})
  - label: Fat %
    value: sum(fat_{row} * 9) / sum(cal_{row}) * 100 & "%"
```

**`{row}` placeholder** — substituted with the row's key (e.g. `"breakfast"`) before expression evaluation. `totalRow` always uses key `"total"`.

**New parameters:** `rows`, `totalRow`, `showEmptyRows`, `dateFormat`

---

### v1.1.7 — Remove `x` Multiplication Alias

The `x` multiplication alias was removed. Use `*` only.

---

### v1.2.0 — Bills Tracker

A new `type: bills` chart and `Generate Monthly Bills` command for tracking recurring bills and subscriptions.

**Vault structure:**
```
Data/Bills/
  Bill-Internet.md          ← master bill notes
  Bill-Electricity.md
  Payments/
    BP-2026/BP-2026-05/
      Internet-2026-05.md   ← monthly payment notes (auto-created)
      Electricity-2026-05.md
```

**Master bill frontmatter fields:**
```yaml
bill_active: true               # checkbox property — true = active
bill_amount_due: 89.99          # optional for variable bills
bill_company: Xfinity
bill_due_date: 2024-01-15       # anchor date — day-of-month + billing start
bill_frequency: monthly         # monthly / quarterly / annually
bill_type: Utility
```

**Payment note frontmatter fields** (alphabetical, auto-written):
```yaml
bill_amount_due: 89.99
bill_amount_paid: 89.99
bill_company: Xfinity
bill_due_date: 2026-05-15
bill_name: Internet
bill_paid_date: 2026-05-14
bill_status: paid               # paid / unpaid
bill_type: Utility
```

**Codeblock:**
```yaml
type: bills
bill_type: Utility   # optional — omit to show all active bills
```

**Rendered output:**
- Two sections — *This Month* and *Next Month*
- Columns: ☐ (paid checkbox), Bill, Company, Due, Amount Due, Amount Paid, Paid Date
- Overdue rows (unpaid + due date ≤ today) render in bold red
- Clicking the checkbox opens a *Record Payment* modal to confirm amount and paid date

**`Generate Monthly Bills` command:**
- Scans all active master notes and creates any missing payment notes for the current month

---

### v1.3.1 — Reading Challenge

New **Tracker Pro: Reading Challenge** command. Opens a year selector then renders an
interactive reading progress modal with a Goodreads-style layout.

**Hero section**
- Colored square badge tile on the left — year in large bold white text with a 📖 icon below; uses `--color-accent`
- To the right: **Reading Challenge** title + **Change Year ▾** button on the same row
- Motivational subtitle adapts to your situation:
  - On track → "You're on track! Keep reading."
  - Behind → "Press on! Read N book(s) to get back on track."
  - Past year met → "Challenge complete! You met your goal."
  - Past year missed → "You read N of G books."
  - Future year → "Goal: G book(s)"

**Progress section**
- Bold stats line: `N of G books read | D days left` (or "Completed" for past years)
- Pill-shaped progress bar with the percentage label outside to the right: `[████░░░░] 25%`

**Book list** — numbered, sorted by finish date
- Clickable title (opens the note), author to the right
- Optional series line below (e.g. `The Stormlight Archive #1`)

**Historical summary table** — one row per year in the goal file
- Columns: Year / Goal / Read / Result (✅ Met / ❌ Missed / In progress)

**Vault setup:**
- Goals: a single note (default `Data/Reading Goals.md`) with one `reading_goal_YYYY` number property per year, e.g. `reading_goal_2026: 12`
- Books: any note in the configured folder whose basename starts with the configured prefix and has `read_complete: YYYY-MM-DD` in frontmatter

**Three new settings:** Book notes folder · Book note prefix · Reading goal file

---

### v1.3.0 — Auto-Refresh Cache Fix

Fixed the bills chart not updating after recording a payment.
The chart now waits for Obsidian's metadata cache to process the
saved payment note before re-rendering, so the paid status,
amount, and date appear immediately without navigating away.

---

### v1.2.9 — Edit Meal Log v2

The "Edit today's meal log" command has been replaced by a unified **Edit meal log** command.

On invoke, today's log opens immediately in a persistent modal. A **Switch date** button in the modal header opens a fuzzy picker of the 30 most recent log files (newest first) to switch to any past log without closing the modal.

**Four edit actions available at any time:**
- **Change quantity** — pick a meal and item, pre-fills the current amount, re-uses the AmountModal
- **Remove item** — pick a meal and item to delete; meal heading is always retained
- **Add item to a meal** — full food/recipe search, same UX as Log Meal
- **Add a meal block** — same as above; picks meal type first then searches

**Save and recalculate:** on save, nutrition values are re-pulled fresh from each food/recipe source note (not re-summed from stored log values). A timestamped `- YYYY-MM-DD — Log recalculated` bullet is appended to a `## Notes` section at the bottom of the file (created automatically on first save). The entire file is rewritten.

---

### v1.2.8 — Auto-Refresh on File Change

`tracker-pro` code blocks now automatically re-render whenever a file in their
configured data source changes. Uses `metadataCache.on("changed")` (fires after
frontmatter is re-parsed, not just after disk write) scoped to a
`MarkdownRenderChild` for proper lifecycle management — listeners are cleaned up
when the block leaves the DOM.

The ↻ Refresh button has been removed from the bills chart as it is no longer
needed.

---

### v1.2.7 — Fix `maxBreaks()` Ignoring Range Start

`calcMaxBreak` was only looking at gaps between existing entries, so a gap from the range start date to the first entry was never considered. For example, a `this-year` range with no entries until April would report a much smaller longest break than the actual ~98-day gap from January.

Fixed by passing `rangeStartMs` (derived from the minimum `pt.date` across all series, which the data collector clips to the range start) into `calcMaxBreak` and including the lead gap as a candidate before scanning between entries.

---

### v1.2.6 — Fix Duplicate Payment Notes on Sync

The chart was auto-creating next-month payment notes on every render. When both mobile and desktop rendered before Obsidian Sync propagated the file, each device created the same note independently — producing sync conflict duplicates.

Fixed by removing auto-creation from the renderer entirely. Next-month bills now display from master note data (same as this month) until a payment note actually exists. The **Generate Monthly Bills** command remains the correct way to pre-create payment notes in bulk; paying a bill via the checkbox also creates the file on first use.

---

### v1.2.5 — Persist Bills Sort and Column Visibility

Sort column, sort direction, and hidden columns are now saved to `localStorage` and restored when navigating back to the note. State is scoped per `bill_type` filter, so different bills charts can have independent preferences.

---

### v1.2.4 — Bills Table Column Sorting and Hiding

**Column sorting:** click any column header to sort ascending (↑), click again for descending (↓), click a third time to clear. The active sort column header is highlighted.

**Column hiding:** a **Columns ▾** dropdown in the top-right of the chart lets you toggle any column on or off. Both settings persist across re-renders (refresh, checkbox, etc.) until the note is reloaded.

The master note link priority (Bill name → Company → none) updates automatically as columns are hidden.

---

### v1.2.3 — Bills Table Master Note Linking

The Bill column now renders as an Obsidian internal link to the master bill note. Clicking the bill name opens `Data/Bills/Bill-{Name}.md` directly.

Priority order if columns are ever hidden: Bill name link first, Company link second, no link if both hidden. Currently both columns are always shown so the Bill column always carries the link.

---

### v1.2.2 — Bills Settings Fix and Refresh Button

- Fixed the Bills settings section header which still showed the old `{YYYY}`, `{MM}` variable syntax instead of `{{DATE:FORMAT}}`
- Added a **↻ Refresh** button to the bills chart so the view can be manually reloaded after recording a payment (useful when the metadata cache hasn't updated yet)

---

### v1.2.1 — Configurable Bill Folder Paths

The hardcoded bill paths were replaced with two plugin settings, letting users store bills anywhere in their vault. The payment folder template uses the same `{{DATE:FORMAT}}` token syntax as the Meal Logger, with FORMAT being any moment.js format string.

**Two new settings fields:**
- `Bills master folder` — e.g. `Data/Bills` (default)
- `Bills payment folder template` — e.g. `Data/Bills/Payments/BP-{{DATE:YYYY}}/BP-{{DATE:YYYY-MM}}` (default)

---

### Release Workflow Fix

The `.github/workflows/releases.yml` was broken — it used `yarn` instead of `npm`, referenced non-existent action versions (v6), and included a `yarn zip` step with no matching script. Fixed to use `npm install` / `npm run build`, correct action versions (v4), and removed the zip step.

Now when you publish a release on GitHub with a new tag, the workflow automatically builds and attaches `main.js`, `manifest.json`, and `styles.css`.

---

## Roadmap

These were discussed but not yet built:

### 1. Conditional formatting in tables
Color cells based on thresholds (green / yellow / red). Most impactful for nutrition and exercise tracking. Would reuse the threshold concept already present in the gauge chart.

```yaml
columns:
  - label: Calories
    value: sum(cal_total)
    thresholds:
      - value: 1800  color: green
      - value: 2200  color: orange
      - value: 9999  color: red
```

### 2. Stacked bar chart
A `stacked: true` option on the existing bar chart. Natural fit for visualizing macros (carbs / fat / protein) per day as a single stacked bar.

### 3. Recent foods in the meal logger
Track the last 10–15 logged foods and show them at the top of the search. High-value UX improvement, especially on mobile where typing is friction.

### 4. Multi-folder data sources
A `folders:` array to query across multiple folders in one chart block. Currently limited to a single `folder:`, `file:`, or explicit `files:` list.

### 5. Click-through on table rows
Clicking a row opens the source note. Very Obsidian-native and useful for drilling into a specific day's log from a summary table.

### 6. Meals Feature

[[Tracker Pro - Meals Feature|Meals]] would be a saved combination of Foods and/or Recipes that are always eaten together, always representing one serving of the complete plate. They would live in `Data/Meals/` alongside `Data/Food/` and `Data/Recipes/`. Tabled for now
