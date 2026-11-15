# Frontend refactor: one component per file, a folder per page

Planned 2026-11-15. The goal is code that's easy to find and read: every page gets a folder, each
component its own file with a name that says what it shows. No behavior or look changes. Each
session below is one page (or one shared area), sized to finish, check and review in one sitting.

## Status

| # | Session | Today | Status |
|---|---------|-------|--------|
| 0 | Shared foundations (break import cycles) | helpers spread across pages | done |
| 1 | Discover | `pages/Discover.tsx` (1,095 lines) | done |
| 2 | Application detail | `ApplicationView.tsx` (457) + `InterviewNotes.tsx` (225) | todo |
| 3 | Process timeline | `ProcessTimeline.tsx` (393) | todo |
| 4 | Notes editor | `NotesEditor.tsx` (534) | todo |
| 5 | Calendar | `pages/Calendar.tsx` (335) | todo |
| 6 | Dashboard | `pages/Dashboard.tsx` (292) + `FlowChart` (288), `Insights` (127), `MiniCalendar` (77) | todo |
| 7 | Applications (board and list) | `pages/Applications.tsx` (203) + `applications/Board.tsx` (243) + `AllTable.tsx` (94) | todo |
| 8 | App shell and the `src/` root | `App.tsx` (194), `campaign.tsx`, `auth.ts`, `AuthGate.tsx`, `useAsync.ts` | todo |
| 9 | Small pages and the shared application widgets | Inbox, Interviews, Campaigns, Add; `PasteAssistant` (257), `ApplicationForm` (211), `ReviewDialog` (202), `ApplicationPicker`, `PasteFill`, `SalaryInput` | todo |
| 10 | Optional: split `api.ts` | `api.ts` (637) | todo |

Order: 0 first (later sessions depend on it). After that any order works; the list goes biggest
first. 2 before 3 (the timeline moves into the application folder). 10 last, it touches every file.

## Target layout

```
src/
  main.tsx
  index.css
  app/                      # the shell: layout, sidebar, routes (session 8)
  pages/                    # one folder per route; only that route uses what's inside
    Dashboard/
      DashboardPage.tsx     # the route component (default export)
      KpiTiles.tsx
      ...
    Discover/
    ...
  features/                 # domain pieces used by two or more pages, or by the shell
    application/            # ApplicationView, ApplicationForm, PasteAssistant, ReviewDialog...
    interviews/             # TypePicker
    notes/                  # the notes editor (dialog + its own route)
  components/               # generic, not tied to a domain
    ui/                     # shadcn, untouched
    common.tsx              # StatusDot, StatusBadge, Loading, PageHeader, Empty...
    Field.tsx
  lib/                      # hooks and pure helpers with no JSX layout of their own
  api.ts                    # (session 10 may split it)
```

## Rules for every session

1. **Move, don't change.** JSX, class names, copy, props behavior and comments stay as they are.
   A session that finds a bug writes it down here (under "Found while refactoring") instead of
   fixing it in the same diff, so the review is only about structure.
2. **One component per file**, file named after the component (`PostingCard.tsx` exports
   `PostingCard`). Exception: a private helper under ~15 lines used by only one component
   (`Chip`, `Bar`, `Tile`) stays in that component's file.
3. **Names say what it is.** Rename generic names when they move: `Card` → `BoardCard` (it
   clashes with shadcn's `Card`), `Row` → `ListRow`, `Header` → `EditorHeader`, `AllTable` →
   `ApplicationsTable`, `Filters` → `FiltersPanel`, `Dot` → `NodeDot`.
4. **Pages** live in `pages/<Name>/<Name>Page.tsx` with a default export, every page in a folder
   even if it's one file for now. Everything else uses named exports. No `index.ts` barrels.
5. **Non-component code** gets its own file in the folder: constants (`constants.ts`), pure helpers
   (a name like `format.ts` or `query.ts`), hooks (`useX.ts`).
6. **Shared only when shared.** Something goes to `features/`, `components/` or `lib/` only if two
   or more places use it. Otherwise it stays in the page folder.
7. **Imports**: `./` inside the folder, `@/...` for anything outside it (no `../../../`).
8. **`git mv`** the original file to its new main component before splitting, so history follows.
9. **Soft size target**: ~150 lines per file. A page component should mostly be data loading and
   composition.
10. **Done means**: `npm run typecheck` and `npm run build` pass, nothing imports the old path
    (`grep`), the status table above is updated, and the user reviews the UI (no screenshots or
    browser on our side, per CLAUDE.md). One commit per session: `Frontend refactor: <session>`.

---

## Session 0: shared foundations

Small, mechanical, and it removes the import cycles that later splits would trip on
(`ApplicationView` ⇄ `InterviewNotes` ⇄ `NotesEditor`, all through `Field`, `interviewName` and
`useOpenEditor`).

| Move | From | To | Used by |
|------|------|----|---------|
| `Field` | `ApplicationView.tsx` | `components/Field.tsx` | ApplicationForm, NotesEditor, InterviewNotes, Campaigns |
| `interviewName`, `talkWith`, `INTERVIEW_TYPES` | `InterviewNotes.tsx` | `lib/interviews.ts` | Dashboard, Calendar, Interviews, Insights, MiniCalendar, NotesEditor, ProcessTimeline |
| `SOURCE_ICON` (copied three times), `SOURCE_LABEL` | `NotesEditor.tsx`, `InterviewNotes.tsx`, `pages/Interviews.tsx` | `lib/interviews.ts` | same three |
| `TypePicker` | `InterviewNotes.tsx` | `features/interviews/TypePicker.tsx` | NotesEditor, Insights |
| `useOpenEditor` | `NotesEditor.tsx` | `lib/useOpenEditor.ts` | Calendar, Interviews, Insights, InterviewNotes, ProcessTimeline |
| `plainText` | `NotesEditor.tsx` | `lib/notes.ts` | Interviews, InterviewNotes |
| `fold` | `ApplicationPicker.tsx` | `lib/text.ts` | Applications |
| `shortAgo` | `pages/applications/Board.tsx` | `lib/format.ts` (new) | AllTable |
| `CHANNELS`, `SENIORITY` | `ApplicationForm.tsx` | `lib/applicationOptions.ts`, renamed `APPLICATION_SENIORITY` (Discover has its own `SENIORITY` map) | ApplicationView |
| URL-param patch helper (`set(patch)`, copied in Calendar and Applications; Discover has `update`) | three pages | `lib/useSearchParamsPatch.ts`, returning `[params, patch]`, using the functional `setParams` form | Calendar, Applications, Discover (which keeps its own "reset `page`" on top) |

No component splits in this session.

---

## Session 1: Discover

The biggest file. Keep `settings/` self-contained: plan §21 round 6 later turns the sheet into its
own route, and with this layout that becomes a routing change.

```
pages/Discover/
  DiscoverPage.tsx            # URL params, the two useAsync calls, layout
  constants.ts                # VIEWS, PAGE_SIZE, FILTER_PARAMS, SENIORITY, COMPANY_SIZE, SECTOR,
                              # WORK_MODE, LOCATION_FIT, EMPLOYER, POSTED, DROP_LABEL
  query.ts                    # View, StatusFilter, queryFor, pageOf, techsOf
  format.ts                   # salaryOf, usdSalary, safeUrl, duration, eta
  useDiscoveryJob.ts          # Job, useDiscoveryProgress, start(), the "run ended elsewhere"
                              # effect; returns { working, progress, start, panelKind, collectOnly }
  RunButtons.tsx              # RunButtons, was RunButton (Collect only / Score pending / Run now)
  SeedEmptyState.tsx          # "No saved searches yet" + Load the defaults
  ListToolbar.tsx             # verdict toggle, status and sort selects
  filters/
    FiltersPanel.tsx          # Filters
    TextFilter.tsx
    FacetSelect.tsx
    SourceSelect.tsx          # the hard-coded source NativeSelect
    TechPicker.tsx
  progress/
    RunProgressPanel.tsx      # ProgressPanel (keeps Bar inside)
    ProgressStep.tsx          # Step, StepState
    LastRunSummary.tsx        # LastRun
  postings/
    PostingList.tsx           # count line, cards, Previous/Next
    PostingCard.tsx           # layout only
    PostingActions.tsx        # Applied / Interested / Not for me / Hide company / Open
                              # application, with setStatus, hideCompany, apply and `busy`
    PostingChips.tsx          # the chip row (keeps Chip inside)
    PostingTechTags.tsx
    VerdictBadge.tsx
  settings/
    SettingsSheet.tsx         # sheet, criteria textarea, save, re-score
    RulesEditor.tsx           # number fields + the rule lists (keeps NumberField inside)
    WatchlistSection.tsx      # Watchlist
    SearchesSection.tsx       # saved searches list (keeps the row inside)
    AddSearchForm.tsx         # the per-source inputs and their eight useState
    constants.ts              # LIST_FIELDS, GETONBRD_CATEGORIES
    paramsSummary.ts
```

As built: `LIST_FIELDS`, `GETONBRD_CATEGORIES` and `paramsSummary` live in `settings/` (only the
sheet uses them), so the folder needs nothing from the rest of the page. The two source selects
stay hard-coded `NativeSelectOption` lists (`filters/SourceSelect.tsx`, `AddSearchForm.tsx`) rather
than option arrays, so the JSX is unchanged. `ProgressPanel` → `RunProgressPanel`, `Step` →
`ProgressStep`, `LastRun` → `LastRunSummary`, `Watchlist` → `WatchlistSection`, `Searches` →
`SearchesSection` (it passes its `run` error-and-reload wrapper to `AddSearchForm`).
`PostingActions` renders a fragment inside the card's actions row, next to the Description
trigger, so the DOM is the same. Files in subfolders import page-level files as
`@/pages/Discover/...`.

Watch out for: `PostingCard`'s `busy` state is shared by all its buttons; it moves with the
actions into `PostingActions`. `TextFilter`'s debounce effects stay exactly as written.

---

## Session 2: Application detail

`ApplicationView` is used by two routes (the `/applications/:id` page and the sheet on
Applications), so it goes to `features/`. `InterviewNotes.tsx` is only its "Interviews & notes"
section.

```
features/application/ApplicationView/
  ApplicationView.tsx         # load, save(), setStage(), compose the sections
  ApplicationHeader.tsx       # eyebrow + Open page, company, role, stage, next interview,
                              # posting link, ProcessTimeline, review banner
  StagePicker.tsx
  NeedsReviewBanner.tsx
  Section.tsx
  properties/
    PropertiesList.tsx        # Properties
    PropertyRow.tsx           # Prop
    EditableText.tsx
    SelectField.tsx
    SalaryField.tsx
  activity/
    ActivitySection.tsx       # the events list and its empty state
    EventItem.tsx
    awaitingReply.ts
  interviews/                 # was InterviewNotes.tsx
    InterviewsAndNotes.tsx
    InterviewRow.tsx
    InterviewForm.tsx
    NoteCard.tsx
  PasteMoreInfo.tsx           # the collapsible around PasteAssistant
  DeleteApplication.tsx       # DeleteButton
pages/Application/
  ApplicationPage.tsx         # was pages/ApplicationPage.tsx
```

`ghostField` (class string shared by `EditableText` and `SalaryField`) goes to
`properties/ghostField.ts`.

---

## Session 3: Process timeline

Only `ApplicationHeader` uses it, so it lives inside the application folder.

```
features/application/ApplicationView/ProcessTimeline/
  ProcessTimeline.tsx         # the row of steps, the "what's next?" tail, opens PlanDialog
  TimelineStep.tsx            # one node with its connector and popover
  NodeDot.tsx                 # Dot
  NodeDetails.tsx             # popover body
  InterviewBox.tsx
  StepActions.tsx
  UseForStep.tsx
  PlanDialog.tsx
  PlanStepRow.tsx             # PlanRow
  timeline.ts                 # KIND_LABEL, OUTCOME_ICON, OUTCOME_DOT, shortDay, reached,
                              # nodeKey, caption, stateText, parseSteps, attempt
```

---

## Session 4: Notes editor

Mounted by the shell (the dialog) and two routes, so `features/notes/`.

```
features/notes/
  EditorDialog.tsx            # over any page (?interview=, ?note=)
  EditorPage.tsx              # /interviews/:id and /notes/:id
  InterviewEditor.tsx         # load, note slots, general talk vs interview
  NoteEditor.tsx              # a general note (or new:<application id>)
  EditorHeader.tsx            # Header
  AppLink.tsx
  NoteTabs.tsx                # "Note 1 / Note 2" tabs
  NoteActionsMenu.tsx         # Add another note / Delete this note
  NoteDoc.tsx                 # editor + side panel, autosave wiring
  NoteDetailsPanel.tsx        # the aside: rating, interviewers, topics, questions, went well/wrong
  SelfRating.tsx              # the five stars
  TalkDoc.tsx
  SaveIndicator.tsx
  useAutosave.ts              # with the module-level `inflight` set and `settled()`
  draft.ts                    # Draft, draftOf, isEmpty, and the Draft → Note data mapping
  RichEditor/
    RichEditor.tsx
    EditorToolbar.tsx         # Toolbar
```

Watch out for: `inflight` must stay one module-level set (exported `settled()` from
`useAutosave.ts`), since `EditorDialog` and `EditorPage` wait on it.

---

## Session 5: Calendar

```
pages/Calendar/
  CalendarPage.tsx            # view toggle, data, picks the view
  calendar.ts                 # KIND, isMeeting, who, meetingChip, END_CAP, OUTCOME_TEXT
  Dot.tsx
  Legend.tsx
  month/
    MonthView.tsx             # state: month, selected day, byDay
    MonthNav.tsx              # title, previous / Today / next
    MonthLegend.tsx
    MonthGrid.tsx             # weekday header + cells
    DayCell.tsx
    DayAgenda.tsx             # the side card for the picked day
    DayAgendaItem.tsx         # meeting row vs milestone row
  processes/
    ProcessesView.tsx
    ProcessesLegend.tsx
    TimelineAxis.tsx          # the week labels row
    ProcessRow.tsx            # name, bar, days column
    ProcessBar.tsx            # bars, end cap, first reply mark, interview dots
    timelineScale.ts          # start, end, span, x(), width(), mondays
```

`MiniCalendar` (Dashboard) repeats the month math (`shiftMonth`, the grid of days). Move that math
to `lib/days.ts` (`shiftMonth`, `monthDays`) and use it from both.

---

## Session 6: Dashboard

```
pages/Dashboard/
  DashboardPage.tsx           # the three useAsync calls, layout
  KpiTiles.tsx                # the four tiles (keeps Tile inside)
  UpcomingInterviewsCard.tsx
  NextInterview.tsx           # the big "next one" block inside it
  JoinCallButton.tsx
  NeedsAttentionCard.tsx      # review / unmatched emails / calendar to match
  AttentionItem.tsx           # the block repeated three times in it
  FlowCard.tsx                # "Where applications went"
  JustHappenedCard.tsx
  AwaitingReplyCard.tsx       # with the "Done" handler (markReplied)
  NoNewsCard.tsx
  ListCard.tsx
  ListRow.tsx                 # Row
  MiniCalendar.tsx            # from components/
  FlowChart/                  # from components/FlowChart.tsx
    FlowChart.tsx
    layout.ts                 # build, rank, chainPath, AFTER, sizes, color
    useWidth.ts
  InterviewTypes/             # from components/Insights.tsx
    InterviewTypesCard.tsx
    TypeRow.tsx               # TypeRowView
    OutcomeLegend.tsx         # Legend + Swatch
    OutcomeTrack.tsx          # Track
```

`inFlow` and `flowLabel` are used by Applications, so they go to `lib/flow.ts` (FlowChart imports
them from there too). The name `FlowChart` stays: plan.md and the `--flow-*` colors use it.

---

## Session 7: Applications (board and list)

```
pages/Applications/
  ApplicationsPage.tsx
  viewPreference.ts           # VIEW_KEY, storedView, saving it
  useApplicationFilters.ts    # q, status, needs_review, flow → searched, counts, listed
  useBoardActions.ts          # move() and confirm(), the optimistic updates and Undo toast
  ApplicationsToolbar.tsx     # view toggle, search, Only to review, flow chip
  FlowFilterChip.tsx
  StatusFilterChips.tsx
  ApplicationSheet.tsx        # the Sheet around ApplicationView
  board/
    Board.tsx                 # DndContext, sensors, drop handling
    BoardColumn.tsx           # Column, expanded and collapsed
    BoardCard.tsx             # Card: the draggable wrapper
    BoardCardBody.tsx         # CardBody (also the drag overlay)
    boardSort.ts              # byUrgency, collision
    useCollapsedColumns.ts    # COLLAPSED_KEY, storedCollapsed, toggle
  table/
    ApplicationsTable.tsx     # AllTable
```

---

## Session 8: App shell and the `src/` root

```
app/
  App.tsx                     # layout: sidebar, mobile sheet, main, EditorDialog
  AppRoutes.tsx               # the <Routes> list
  MobileHeader.tsx
  Sidebar.tsx
  SidebarNav.tsx              # NavLink list + inbox count
  nav.ts                      # NAV
  ScanButton.tsx
  scanSummary.ts              # scanSummary, calendarSummary
  ThemeSwitch.tsx
  AuthGate.tsx                # from src/
lib/
  auth.ts                     # from src/
  campaign.tsx                # CampaignProvider, useCampaign (from src/)
  useAsync.ts                 # from src/
components/
  CampaignPicker.tsx          # from campaign.tsx (sidebar and mobile header)
```

Update `main.tsx` imports. After this the `src/` root only holds `main.tsx`, `index.css`,
`api.ts` and the folders.

---

## Session 9: small pages and the shared application widgets

```
pages/Inbox/
  InboxPage.tsx
  CalendarMatchSection.tsx
  CalendarMatchItem.tsx       # CalendarItem
  UnmatchedEmailItem.tsx      # InboxItem
pages/Interviews/
  InterviewsPage.tsx
  InterviewGroup.tsx          # Group
  InterviewLink.tsx           # with When and NotesBadge (small, private)
  GeneralTalkRow.tsx          # GeneralRow
pages/Campaigns/
  CampaignsPage.tsx
  NewCampaignForm.tsx         # if the form is inline in the page
  CampaignCard.tsx
pages/AddApplication/
  AddApplicationPage.tsx
features/application/
  ApplicationForm/
    ApplicationForm.tsx       # state, fill/undo, submit
    (split into field groups only if it's still long after the move)
  PasteAssistant/
    PasteAssistant.tsx        # text box, read(), apply()
    PasteRecordCard.tsx       # one record: option, fields, stage, skip
    PasteSummary.tsx          # the "what will change" box
    paste.ts                  # Selection, KIND_TEXT, KIND_CLASS, show, defaults, the summary
  PasteFill.tsx
  SalaryInputs.tsx            # from SalaryInput.tsx, with its draft helpers in salary.ts
  ApplicationPicker.tsx
  ReviewDialog.tsx
```

Read `PasteAssistant`, `ApplicationForm` and `ReviewDialog` fully at the start of the session;
the split above is from a skim, adjust it to what's there.

---

## Session 10 (optional): split `api.ts`

```
api/
  types.ts                    # the interfaces (or one file per area: applications, interviews,
                              # discovery…)
  client.ts                   # the request helper and the `api` object
lib/
  format.ts                   # fmtDate, fmtTime, localDay, daysAgo, timeAgo, relativeDay, label,
                              # fmtSalary, dayToIso, isoToDay, isoToDateTime, dateTimeToIso
  errors.ts                   # errorText
```

Touches nearly every file's imports, so it goes last and is only worth it if `api.ts` keeps
growing.

---

## Found while refactoring

(Bugs or oddities noticed during a session, left for a separate change.)

- Session 0: react-router 7's functional `setParams` form gets the params of the last render, not
  the latest ones, so two `patch` calls in a row still overwrite each other (same as before). Each
  change has to go in one call. Not a bug today, but worth knowing.
