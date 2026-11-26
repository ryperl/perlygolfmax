# Perly Golf Max

A mobile-first golf-trip companion for a planned group of 12 golfers and five
rounds. Golfers browse active events, enter scores and view standings/winnings
without accounts. Organizers sign in separately for management. A separate
**read-only fictional preview** never substitutes for saved data.
Local identity/API configuration is optional and explicitly unconfigured by
default; score entry is online-only, not an offline-capable tournament app.

## Local setup

Use Node.js 22.14.0 (see `.nvmrc`) and npm 10.

```bash
nvm use
npm ci
npm run dev
```

Open the localhost URL printed by Vite. No account, environment variables,
database, or Azure services are required. Dependencies and the committed
lockfile use public open-source npm packages. Use only a package source approved
for your machine; local authentication and registry configuration must stay
outside version control. Never bypass organizational network restrictions.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Local development server, bound to loopback |
| `npm run dev:api` | Build/start configured API; requires Core Tools |
| `npm run typecheck` | Strict TypeScript checks for source, tests, and config |
| `npm run lint` | Type-aware ESLint with zero warnings |
| `npm run lint:docs` | Check README and contributor Markdown |
| `npm test` | Run component, module, and lockfile-tooling tests once |
| `npm run test:watch` | Interactive unit/component test runner |
| `npm run build` | Type check and generate production assets in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run test:smoke` | Chromium and focused iPhone-sized WebKit smoke tests |
| `npm run check:lockfile` | Verify public package URLs and integrity |
| `npm run check:dependencies` | Audit high/critical production advisories |
| `npm run check:infra` | Compile/check test IaC from restored Bicep modules |
| `npm run lockfile:public` | Normalize public-package lockfile URLs, offline |
| `npm run icons` | Regenerate PNG icons with Node.js only |

Before the first browser smoke run, install its browser and build:

```bash
npx playwright install chromium webkit
npm run build
npm run test:smoke
```

The smoke runner manages its own loopback preview server on port 4173; leave
that port available. On Linux, Playwright may also require system dependencies
(`npx playwright install --with-deps chromium webkit`). Browser downloads are separate
from npm installation and must also comply with your machine's policies.

## Implemented scope

- Live Overview, Rounds and The Group views for an explicitly selected saved
  event, using its actual roster, round snapshots, tees and manual groups.
- A separate Preview with a fictional five-round itinerary and twelve-person
  group; fictional data never substitutes for failed or missing private data.
- Hash-based navigation with direct links, browser history, keyboard focus
  management, skip link, and semantic landmarks.
- Forest-green presentation with light surfaces, charcoal text and restrained
  gold headings; a coordinated dark palette follows the system setting at page load.
- Separate typed domain models, fictional fixtures, feature views, and app wiring.
- Web app manifest, SVG favicon, Apple touch icon, standard PNG icons, and a
  dedicated maskable icon with inset artwork.
- Strict checks, component/module tests, production-browser smoke tests, and CI.
- Public Events navigation with explicit unconfigured/loading/empty/error states.
  Separate **Organizer tools** use email-code sign-in for management and creation.
- Ordinary event Active/Archived lists retain owner-only archive and restore.
  The organizer also has protected active/archived Quick-round lists, recovery
  and confirmed permanent deletion of archived events.
- An independent TypeScript Functions workspace with strict JWT validation,
  Table event/membership transactions, idempotent create requests, bounded
  pagination/body sizes and shared ETag-based per-user request limits.
- Local catalog/setup slice (separate release approval required): organizer-only
  reusable course versions and tee profiles, staged validated JSON import,
  reusable players with dated manual Handicap Index history, and saved-event
  owner setup with explicit course/tee selection, roster and manual foursomes.
  Real source exports are never bundled or committed.
- Online gross scorecards from saved round setup, with public score entry for
  any saved playing group:
  explicit hole dispositions, conditional saved scores, correction history
  and complete-versus-incomplete gross summaries.
- Configurable individual Stableford games derived server-side from the same
  stroke cards: gross/net, Standard/Modified Stableford presets, editable scoring
  bands and per-game handicap allowance. Multiple games can share one round.
- Stroke Play, Nassau, Wolf/PIG, independent Dots and Churchie. New Churchie uses
  tee or first-approach partner ordering, actual-circuit rotation and shared
  special-dot configuration with built-in/device-local presets. Saved legacy
  games retain their original rules.
- Ball Drop foursomes (1 Net + 1 Gross, 2 Net or 2 Gross) and individual Gross/
  Net Skins with optional carryovers, derived from saved numeric strokes.
  No golfer account, admission or tester link is required in the public app.
  This is not offline recording or a finalized tournament scoreboard.

The public Events screen needs only an API URL; organizer tools additionally
need approved identity configuration. Organizer sign-in and event creation have been
manually verified in isolated test; archive/restore also has automated coverage.
This does not establish all live authorization, concurrency or recovery cases.
The fictional Preview remains available without configuration. Main navigation
starts at Events, not the demo. See [architecture, security and recovery](docs/operations.md)
for setup requirements, controls, residual risks and separate approval gates.

Bundled names, locations, courses, and tee times are **fictional sample content**.
The repository contains no real bookings, invitations, scores, handicap indexes,
or identities. Saved events live separately in the configured environment.
**Active events are public:** any visitor can view rosters, scores and winnings
and edit scores. Do not put information in active events that should stay private.
General ordinary-event management, raw index observations, audit identities and
archives remain protected. Any visitor may configure a foursome's internal
games before scoring, including in an ordinary event. Public Quick rounds
additionally allow shared event setup and other supported game editing.
Anonymous changes cannot be attributed to a verified person.
Never commit real trip data, contact details, account identifiers, credentials,
corporate feed configuration, or secrets to this public repository.

### PWA and offline boundaries

Base colors are centralized in `src/app/styles.css` as `--cp-*` theme variables;
feature styles consume them rather than hardcoding colors. Keep the HTML theme
metadata, manifest, SVG favicon and `scripts/generate-icons.mjs` in sync when
changing the brand palette, then run `npm run icons` to regenerate the PNG assets.

Saved round cards and scoring views use the shared
`src/features/round-theme/` pastel accents. The selected round scopes active
scoring tabs, hole/card headers, scorecard totals and nine selectors, KP accents,
game selectors and skins detail highlights, not just the round picker.
Accents follow configured round order, not date-sorted display order, so the
same round stays recognizable across these views. Eight accents cycle for
larger events; this does not limit round count. Light/dark variants retain
high-contrast text, neutral score fields and unchanged warning/status colors.
Primary save actions, saved/unsaved/error feedback and golf score marks retain
their existing functional colors rather than inheriting decorative accents.
Round names remain visible: color is supplementary, never the only identifier.

**Rounds** and **The Group** share the same roster-card presentation. Playing
groups show a compact header with their saved starting hole and aligned golfer/
CH rows. Competition teams remain separate cards with their actual members;
unassigned golfers and stale team warnings stay visible. The CH column omits
repeated prefixes but retains scratch `0`, plus values, explicit `NH` and
unavailable `—`, with full accessible labels. Event roster values remain current
Handicap Index, not round Course Handicap.

The manifest and icons are a PWA foundation, not a guarantee of installation on
every browser or platform. There is **no service worker**, explicit offline
cache, offline score storage, synchronization, or update prompt. An already-open
page can continue displaying its bundled demo data without a connection, but
offline navigation/reload is not supported or guaranteed. New builds are picked
up on normal network reload; there is no service-worker update lifecycle.
Production PWA capabilities require HTTPS and platform-specific verification.

### Returning between holes

Select an event, round and playing group once. Enter scores, tap **Save & Next
Hole**, and wait for the green saved indicator before closing the app. A cold
launch from the
site/home-screen entry restores the last round, group, hole and view and fetches
fresh server scores. Returning to a running/backgrounded page refreshes safely
without resetting that position or overwriting local drafts. Failed/conflicting
saves do not advance or claim confirmation.

Enter scores opens a focused scoring region without opening the phone keyboard.
The **Round** picker and the Scorecards, Enter scores, Games and Leaderboard
buttons stay visible. Foreground requests and unsaved score/game edits block
round switching. Small screens use compact icons with Cards, Score, Games and
Board captions; Refresh uses an icon. Full accessible action names and 44px
touch targets remain, while wider screens retain full text labels.
**Save & Next Hole** is the only entry save action; **Refresh**
sits below it and never submits scores. Other views retain toolbar Refresh.
Save/discard actions and the compact status indicator keep a stable place
below the inputs; changing a score does not insert controls above the fields.
The indicator shows a pending count only when needed, announces its state to
assistive technology, and confirms only acknowledged writes. Routine successful
refreshes have no message box; failures, conflicts and partial saves stay explicit.
Discard clears all local unsaved scores for this round, not saved server scores.

Organizers select a starting hole for each playing group during round setup,
including back-nine and shotgun starts. Existing groups without a saved start
use the first hole in their captured layout. Hole arrows wrap in both directions
without saving. **Save & Next Hole** follows one circuit from the group's start,
then opens scorecards after the preceding hole (10–18, then 1–9 for a start on
10). This is navigation, not round finalization; unplayed holes remain unplayed.
Reopening uses the remembered hole instead of resetting to the starting hole.
Starting holes follow the existing scored-round setup locks.

Round setup also accepts an optional first tee time in the course's local time.
Overview and Rounds display that saved time. It is schedule metadata and remains
editable after scoring starts; course, tees, players and group starts stay locked.
No group stagger interval, date/time-zone conversion or reminder is inferred.
Clearing the field removes the time; legacy requests omitting it retain saved times.

Event setup has optional start and end calendar dates. Overview labels these
**Event Start** and **Event End** in MM/DD/YYYY format; missing dates say Not set.
End dates cannot
precede start dates. Sorting still uses the event start date; end dates do not
archive events or change round dates automatically.

Player catalog renames appear on subsequent event/round/card/result reads,
including already-scored rounds, without resaving each event. The server resolves
names and scalar current indices for the authorized roster; public readers never
receive catalog
profiles or current Handicap Index observations. Captured inputs, saved scores,
score revisions and historical audits remain unchanged. Refresh an open view
to see a rename; unconfirmed local drafts still keep their existing protection.

Public event rosters show current linked **HI**, while round groups and competition
teams show **CH for that round and each golfer's tee**. **NH** means no index is
connected;
legacy projections without this display field show unavailable rather than NH.
Observation sources, dates, histories and audit identities remain private.
Score-entry names and Front/Back/Full scorecard names show server-derived **CH**
using the round's HI and the golfer's
captured tee, before any game allowance. Scratch is CH 0, plus handicaps use
CH +N, and missing ratings show CH unavailable rather than zero. These displays
never rewrite saved course/index inputs, scores or revisions.

Events and rounds also have optional start dates in strict `YYYY-MM-DD` form.
Create an event by name, then edit dates in whole-event organizer setup. Dates
are event/course-local calendar metadata: no timezone conversion, inferred dates
or automatic archiving. Event and round dates remain editable after scoring
starts without unlocking captured scoring inputs. Legacy requests omitting dates
preserve saved values; an explicit blank clears them.

Public and organizer event directories load existing bounded pages serially,
then show all dated events earliest-to-latest followed by undated events, with
event ID order for ties. While pages remain unread, no partially sorted cards
are presented as the complete directory. Errors and quota waits retain loaded
pages for explicit retry; Refresh events restarts from the first page. Each page
still uses the existing server authorization and shared request budgets. This
is not a cross-page snapshot: concurrent event edits may require a refresh.
Saved round displays and selectors sort dated rounds earliest-to-latest, then
undated, preserving configured order for ties. Stored round order, IDs, game
bindings and remembered score entry locations are unchanged.

Overview shows purse/winnings navigation only when the event has a configured
purse. Availability comes from the existing workspace response, not an additional
purse calculation request. Organizers can still configure one in organizer tools.

For an overall Stableford competition, Overview lists the selected saved game
for each round using the existing round-progress reads. Missing selections,
loading and unavailable saved games remain explicit; no default game is invented.
Owner scorecards include a date-ordered saved-round switcher that keeps the
current Scorecards/Games/Leaderboard view. Save or cancel game edits and save
or discard score drafts before switching; active requests also block the switch.

Event group views list the overall-selected game's format and competition teams
below the playing groups. Teams are not inferred from foursomes. Individual games
say they have no competition teams; unavailable and stale assignments remain
visible for organizer review.

Only allowlisted navigation fields are kept in localStorage: version, event ID,
round ID, group number, hole number and view. No scores, drafts, credentials or
personal identities are stored there. Storage failures are visible and allow
scoring in memory, but reopening may require selecting the round/group again.
**Events** always provides an explicit chooser. Archived/removed rounds and
changed group/hole assignments require a fresh selection, never a demo fallback.
This is navigation recovery, not offline score storage or synchronization.

The manifest launches `/`, now the public resume entry rather than sign-in.
Safari home-screen apps may have separate storage from Safari tabs; choose the
round/group once inside that app if needed. Subsequent visits use its own saved
position. Browser tests cover full-app eighteen cold visits at an iPhone 16 Pro
viewport in WebKit; adding an actual iOS home-screen icon remains a device check.

### Future work, not implemented

Owner appointment UI, automated invitation email and offline synchronization
remain later increments. The selected design is Entra External ID
email codes, a standalone Functions API and Table Storage, with SWA staying Free.
Provisioning/deployment is separately approval-gated. Additional scoring rules,
betting, reporting, finalization and retention remain separate scope decisions.
The fictional Preview remains separate from saved scoring and results.

### Public access and legacy links

Golfers use the ordinary site and public event/round URLs. Full course/player
catalogs, ordinary event setup and game configuration, purse changes and audit
history still require organizer authority. Archives remain owner-only.

### Public Quick rounds

Both full event setup and Quick rounds offer **Round holes** after choosing a
tee: play the entire selected tee (including native nine-hole tees), or select
**9 holes — Front (1–9)** / **9 holes — Back (10–18)** on an eighteen-hole tee.
Each group plays one nine-hole circuit from its selected starting hole.
Captures retain printed hole/source identities and the published side rating
and slope, with stroke-allocation ranks normalized within that nine. Personal
tees use their own side inputs. Nine-hole Course Handicap uses the existing
half-index calculation, not half an eighteen-hole Course Handicap. Scoring locks
the selection; Nassau remains eighteen-hole-only and nine-hole WHS differential
estimates remain unavailable.

**Quick round** on Events creates one saved round without sign-in. Enter one
required **Round / event name**, used for both names on a new round. Choose a
published saved course/version and tees, then tap **Add golfers** to search and
select saved players. The picker keeps selections through search and closing;
fifteen golfers fit on one page. Groups fill automatically up to four golfers,
with additional groups as needed. Compact group rows show names and Course
Handicaps; **Edit** opens group assignments, starting holes and personal tees
without changing saved group identities or player order. Each group can have its
own starting hole. Optional per-golfer tees must use compatible saved layouts.
The selection directory publishes course names/versions and player names/current
scalar HI or NH, never private profiles, observation provenance or histories.
Whole-directory search waits for all bounded pages; interrupted reads retain
their cursor and loaded progress.

**New player** adds a reusable shared-directory player without sign-in using
only **Name** and **GHIN Handicap Index (as entered)**. Both are required; zero
and explicit plus values are supported. Entry is manual and unverified, not a
GHIN lookup or posting. After confirmed creation the player is selected in your
round draft; **the round is not saved yet**. Failed/unconfirmed creation keeps
both fields and retries the same attempt. Unconfirmed fields cannot be changed
until confirmed, or explicitly discarded with a warning that creation may
already have happened. A round-save failure never creates the player again.
The action is absent on older services without the advertised capability.
Only new-player creation is public: profile edits, HI corrections and history
remain protected organizer tools.

Quick rounds are explicitly collaborative: **any visitor can edit their setup
and games**. The public directory identifies them for editing; ordinary saved
events do not acquire this policy. Expanded setup retains the same draft,
confirmed event and request identities rather than creating another event.
The bottom **Add games** and **Start scoring** actions replace a separate Save
round button. Each saves the definition first, then waits for acknowledged setup
and scoring context before continuing. **Add games** opens a new game editor
directly through the same authoritative capabilities used by ordinary rounds;
**Start scoring** goes to score entry without creating a game. An uncertain save
keeps its input and retry identity on setup, and an interrupted confirming read
can resume without recreating the round. Players can
return to game setup; existing first-score setup locks still apply.
Stableford, Skins, Ball Drop and enabled Churchie use their existing rules,
team validation and settings; new supported game types use the shared path.
Competition teams are separate from playing groups.
Reopen **Edit Quick round** from the Events list or the active Quick round's
Overview, Rounds or The Group page to change its roster before scoring.
Creating the round alone does not lock golfers. The first saved score or
scoring declaration captures the inputs; clearing scores afterward never unlocks
the roster. Global player-profile editing remains protected catalog management.
Churchie's explicit planned dollars-per-dot setting is part of shared game editing,
not permission to manage purse pools or make payments.

Setup, game saves and confirming reads are separate online operations. If a
later operation fails, the confirmed event remains saved and unconfirmed work
retains its retry identity in memory. Concurrent changes require explicit
refresh/review; scoring navigation does not imply a failed game save succeeded.
No drafts or scores are stored offline. First saved scoring still freezes
**every golfer's** round handicap inputs and locks setup, even after clearing
scores. Ordinary catalog HI edits affect only unstarted rounds; the manager's
explicit roster shortcut can also refresh unfinished rounds in that event.

Any visitor can **Archive** a Quick round from its event card or saved setup,
after explicit confirmation. Archiving conditionally checks the event revision,
retains an immutable public-event receipt and preserves scores, captures and
history. It removes the round from public discovery and stops public reads and
writes. Unconfirmed archive attempts retain the same retry identity; conflicts
require refresh/review. There is no public restore or permanent deletion action.

Apart from the explicit create-only player action, public Quick round management
does not grant catalog writes, private audits,
handicap corrections, purse management, KP administration or archived-data access.
Public discovery excludes interrupted creations until setup publishes. Existing
bounded staged transports, event/card revisions, idempotency receipts and durable
site/event quotas remain enforced. The server persists an explicit Quick-round
policy so future account-based restrictions can change without replacing the
scoring model; no owner account or membership is fabricated.

### Organizer recovery and permanent deletion

The signed-in organizer has separate **Active Quick rounds** and **Archived
Quick rounds** lists, including rounds created anonymously. **Load Quick rounds**
starts a bounded paginated read; continue loading or retry an interrupted page.
This does not turn a Quick round into a privately owned event. Only the organizer
can restore a Quick round; anonymous visitors cannot browse archives or restore.
Ordinary private-event archive/restore permissions stay owner-only.

The organizer may permanently delete an **archived** Quick round, or an archived
ordinary event they own, after explicit event-name confirmation. Active events
must be archived first. This removes event-owned scores, rounds, captures,
specials, purse, invitations/access records, audits, staged fragments and
discovery links, never shared course/player catalogs or unrelated events.
It is irreversible, unlike Archive. This feature does not automatically delete
any existing event.

One confirmation runs the whole cleanup. Each request does up to about four
seconds of bounded cleanup on the server, so a typical event finishes in one or
two requests. The page continues automatically, shows which step is running and
how many event records have been removed, retries a brief failure twice, and
waits out the organizer request limit instead of failing. Requests are spaced so
even a very large event stays under that limit.

Interrupted deletions remain unavailable and can be resumed with one click from
**Unfinished deletions**. Completion is acknowledged only after cleanup; a
minimal technical tombstone prevents an old request from recreating the event.
This is application data deletion, not a claim that Azure platform logs or
backups have been erased.
No automatic expiry, retention schedule or new backup guarantee is introduced.

Previously issued tester/admission links open their public event (or its saved
scoring position), remove the secret fragment and do not request account creation.
Their original backend protocols and audit records remain for compatibility;
no grants are silently migrated or promoted. Revoking a legacy link does **not**
block the new public website—public access is a separate, explicitly chosen
policy. Legacy grant expiry/renewal does not control public scoring.

### Online gross scorecards

Any visitor can open scorecards for an active saved round and enter each player's
per-hole gross strokes. Unplayed, picked-up and did-not-finish are distinct
states, never automatic zero/penalty strokes. The normal entry flow is one hole
for one selected group: blank means unplayed, a number means strokes, and `X`
or `X7` means picked up. The number in `X7` contributes seven to the recorded
total but the hole remains picked up, not a completed seven-stroke hole.
A recorded total is labelled incomplete unless every hole has a completed
numeric stroke entry; cards are not ranked
by incomplete totals. Positive whole strokes are bounded only for exact numeric
arithmetic, not by an invented golf scoring cap.

Use the group **Save & Next Hole** action for normal entry. Each player's
acknowledgement is tracked separately: on partial failure, saved values stay
saved, pending drafts remain and the screen does not advance. A foursome uses
one compact card with a row per golfer and one shared save footer; single-player
entry can additionally offer explicit quick scores.
Name headers show subtle **CH 4, SO 1** when an off-low result applies: CH is
the round/tee Course Handicap and SO is the existing handicap difference from
the low player in that playing group, not strokes received on the current hole.
Unknown SO stays **—**; gross scores and gross-qualified specials remain unchanged.
An explicitly selected group-low rule now makes SO available for the supported
round net games; unmarked saved games retain their legacy rules.
Scores stay blank until entered. The first + or − tap on a blank score enters
that hole's par; later taps adjust it. After an 850 ms pause in valid numeric
typing, focus moves to the next empty golfer, allowing multi-digit scores.
Next/Enter does the same immediately. If no empty fields remain, focus moves
to Save without activating it. Navigation, blur, conflicts and busy/read-only
states cancel pending movement; button adjustments do not trigger it.
Opening a round shows a traditional group scorecard immediately: holes run
left to right, with a row per golfer, front/back nines and Out/In/Total columns.
Select a golfer for their individual card, or choose **Enter scores** for the
hole-first editor. Front/back controls and locally scrolling tables with fixed
player labels support narrow screens. Circles/squares mark raw gross strokes
relative to source par, not net or handicap-adjusted results.
Small upper-right dots mark handicap strokes **received**, using the
server-provided Course Handicap and each golfer's captured tee/stroke index,
not the selected game's allowance or Churchie earned dots. One dot means one
stroke, two means two; counts above three use a bounded dot/count label.
For example, CH9 receives a dot on stroke index9 but not10 on an eighteen-hole
layout. An already-calculated nine-hole CH9 receives one on every hole; it is
not halved again. Scratch/plus handicaps have no received-stroke dots. Missing HI
remains NH/unavailable, and positive CH without usable stroke allocation shows
an explicit unavailable indicator. Dots do not change strokes, totals or games.
The round scorecard overview lists its configured games and scoring rules;
the Game selector chooses saved points, team-to-par or skins shown. The round's
back link returns to that event's overview, not its setup editor.
Cards include source yardage, par and stroke index, exact hole shorthand and
recorded totals. Normal score entry has no extra disposition menu or format
instruction paragraph; blank and X shorthand remain supported.
Beside each golfer's Course Handicap, entry shows saved gross progress such as
**Thru 6 +2**, **Thru 6 E** or **Thru 5 -2**. It compares only acknowledged
numeric scores with that golfer's captured personal/default tee par. Missing,
pickup and DNF holes do not count as numeric holes or replace the running
relative score with an incomplete label; they still affect overall completeness.
Unplayed rounds show **Thru 0 —**. Local drafts never change the saved summary.
Pickup or missing values keep subtotals/results marked incomplete. The recap
is available without finalizing a round; no Net or Stableford row is fabricated.
Internal audit records, actor/request IDs, revisions and raw timestamps are not
part of golfer entry or scorecard screens. Cards omit saved-state summaries and
long legends, with only a compact incomplete-total indication when needed.
Audit storage and the owner-protected history API remain unchanged; separate
organizer audit, master-edit and player-report interfaces are not built.

Each saved operation has an idempotency ID, conditional card revision and
immutable before/after/actor/time history. Conflicting edits require explicit
refresh/review; failed local drafts are not confirmed saves. Public writes
conditionally check the active event/card revisions and record an explicit
unverified public actor, never a fabricated account or owner grant. Organizer
and legacy account/tester write checks remain independent. Archived owner cards
are read-only.

The first saved score locks that round's course, tee, roster/group and captured
index inputs, even if all holes are later cleared. Catalog index changes remain
independent. Event name/location edits are not score reinterpretation. There is
no score deletion/unlock/finalization or handicap-policy selector in this slice.

This simulation is online-only. Unsaved drafts exist only in the open page:
closing/reloading it or losing browser storage can lose unsaved work. The PWA
manifest is not offline score storage or synchronization. Keep a paper backup.
Automatic visible-page reads do not guarantee real-time updates, and
another device sees changes only after the server saves them.
Routine background checks do not toggle foreground loading/disabled controls
or replace unchanged round projections. Editing during a pending check preserves
the edit-time card baseline; a save waits for that read rather than overlapping
it. Changed saved data, errors, permission revocation and session expiry remain
visible and guarded.

### Individual Stableford games

Open a saved round's **Games** tab to add games, edit their rules or see results.
Entry stays in gross strokes; changing a game does not rewrite the stroke card.
The scorecard automatically shows the first saved game's per-hole points below
the strokes, including Out/In/Total points. Its **Game** selector switches
between saved games or a strokes-only view, for both group and individual cards.
These are the existing server-derived results, not a second client calculation.
Standard and Modified Stableford presets can each use gross or net scoring, and
multiple games can use the same round. Net allowance defaults to 95% and is
configurable per game in full-handicap mode. The optional **Net handicap rule**
can instead use full captured CH off the lowest in the saved playing group,
without an allowance. See [game starts and net rules](docs/game-rules.md).

Games shows one compact scorecard per configured game, with golfers in rows
and hole points visible without expanding individual golfers. Front/Back
controls choose the visible nine; Out/In/Total remain server-derived values.
The table scrolls as one unit with fixed player labels. Playing handicaps,
progress, partial totals and unavailable inputs remain explicit; this is not
a ranked leaderboard or a second score calculation.

| Result relative to par | Standard preset | Modified Stableford preset |
|------------------------|----------------:|-------------------------:|
| Four under | 6 | Configured better-score value |
| Albatross, three under | 5 | 8 |
| Eagle, two under | 4 | 5 |
| Birdie, one under | 3 | 2 |
| Par | 2 | 0 |
| Bogey, one over | 1 | -1 |
| Double bogey, two over | 0 | -2 |

These are starting configurations, not a universal definition of modified
Stableford. Edit individual points, add contiguous better/worse scoring bands
and set explicit values for scores beyond the listed rows. Initial outside-row
values are 6/0 for Standard and 8/-2 for Modified; they remain editable, rather
than being silently extrapolated. Customized results are labelled custom.
See the [user-selected GolfLink reference](https://www.golflink.com/lifestyle/stableford-scoring-go-big-or-go-home)
and [R&A Rule 21](https://www.randa.org/rog/the-rules-of-golf/rule-21).

Pickup (`X`/`X7`) and per-hole DNF receive the minimum configured points
(initially 0/-2). Unplayed holes remain pending, not automatic zero/negative
points. Partial totals are identified; live leaderboard positions are
provisional rather than completed results.
Missing captured Handicap Index, rating or stroke-allocation inputs make net
results explicitly unavailable; gross results do not require a handicap.

Net calculations use the round's saved tee **Total** rating for its complete
9- or 18-hole layout and the captured manual index, never a later global
catalog/index value. Nine-hole index halving rounds to one decimal first;
allowance applies to the unrounded Course Handicap, followed by final whole
Playing Handicap rounding. Exact decimal ties round toward positive infinity,
including mathematically negative plus-handicap values. This was checked with
synthetic boundary cases against the [official R&A calculator](https://www.randa.org/en/course-handicap-calculator).
Handicap strokes repeat through stroke-index order; plus handicaps give strokes
back starting with the highest stroke index. This is game scoring, not WHS
score posting. The separate estimated differential applies net-double-bogey
caps only to derived adjusted gross, never to these strokes or game results.

Ordinary event-wide game settings are owner-only. Public pre-scoring internal
game configuration is separately scoped to Dots, new Wolf and enabled Churchie;
it cannot change protected peer games, general event setup or purse settings.
Quick rounds retain their other supported public game management. Saves are
online, conditional and idempotent, with
before/after audit records. Active-event games can be added or adjusted on
existing stroke cards; archived events remain read-only. Conflicts preserve
the draft and require explicit refresh/review. Saved-game removal and a
general administrative/history interface are not included. Technical budgets
are 16 games and 32 points rows. Ordinary game, whole-event setup and purse
requests allow 12 KiB UTF-8; other ordinary writes retain their 4 KiB limit.
Larger configurations use bounded immutable upload parts and conditional
publication, not partially active saves. Stored values exceeding an inline
Table property use verified immutable fragments. Large reads are digest-bound
pages reassembled before a complete result is exposed. Coherent read responses
up to 256 KiB of UTF-8 JSON return inline, avoiding repeated whole-event work
for small fragments without caching scores. Larger reads retain digest paging.
Shared public event score reads allow 600 charged units/minute, including
per-round aggregate charges; score writes retain their separate 60/minute limit.
Compute scaling does not bypass these durable application budgets.
Quota waits retain
progress and can be cancelled.

### Team Stableford games

The Games editor also supports explicit competition teams, separate from playing
groups. Every round golfer must belong to exactly one complete team in each game.
Two-person formats require an even roster; four-person formats require a roster
divisible by four. Partners are never inferred or assigned automatically.

| Format | Counting net points on each hole |
|--------|---------------------------------|
| 2-man net better ball | Highest one of two |
| 2-man net Aggregate | Sum both |
| 4-man 2-net Stableford | Highest two; initially Standard |
| 4-man 2-net Modified Stableford | Highest two; initially Modified |

Counting golfers may change every hole. Presets and points remain configurable;
the calculation selects points, not lowest strokes. New team games default to
100% allowance, separately configurable from the unchanged 95% individual default.
Saved allowances are never silently reset.

A team hole waits for every teammate's saved entry, even when enough potential
counting scores are already available. Explicit pickup/DNF entries retain the
configured individual minimum; blanks remain pending. Missing handicap inputs
remain unavailable. Games and Leaderboard show team rows and member names;
golfer scorecard points remain individual components, not credited team totals.
No team playing handicap, concession automation or score copying is invented.

Before scoring locks setup, a roster change may invalidate saved assignments.
These games remain editable but show no team result until assignments are
repaired. Games can be repaired individually without discarding other stale
games. This adds no finalization, payout or event-wide credit policy.

### Ball Drop and Skins

Choose **Game type** in a saved round's Games editor. These version-1 stroke
competitions share the existing saved cards, conditional settings writes, audit
receipts and bounded transport; they are not Stableford presets.

**Ball Drop** uses explicitly assigned four-person competition teams, separate
from playing groups. Choose **1 Net + 1 Gross**, **2 Net**, or **2 Gross**.
Exactly two different golfers count on each hole. The server automatically
chooses the lowest valid combination, summing each selected golfer's strokes
relative to their own captured tee's par: par is 0, birdie −1, bogey +1.
Lowest cumulative team-to-par wins; equal totals share positions. All four
golfers must save a disposition before a hole is evaluated. Pickup/`X7`/DNF
cannot supply a numeric ball. Fewer than two eligible scores makes the team
result unavailable, not a fabricated penalty. Stale roster assignments stay
visible for repair and produce no team result.

**Gross Skins** and **Net Skins** are individual, round-wide competitions.
After every golfer has saved a disposition for a hole, its unique lowest
eligible stroke score wins a skin. Tied lows remain unawarded with carryovers
off; with carryovers on they carry to the next unique winner. Holes are
evaluated in the saved foursome's actual circuit for new carry configurations.
New or changed carryovers require the entire round to be one saved foursome;
unmarked legacy carries retain printed order, including multi-group rounds.
An earlier pending hole blocks later carryover awards. Final tied or otherwise
unclaimed skins remain unawarded; they never roll into another round.
Highest awarded skin count ranks first. A resolved zero wins is distinct from
pending or unavailable awards.

Both formats default to **100% of captured Course Handicap** for net, with an
explicit saved-group-low SO option. Both choices retain
plus handicaps and personal tees; there is no allowance or points-table editor
for these kinds. Missing required net inputs remain unavailable. Calculations
use exact arithmetic and report unavailable overflow without reducing the
existing stroke-input limit. Only saved numeric strokes are eligible; local
drafts never enter results. Partial standings are explicitly provisional and
never declare a winner or finalize a round.

Games, Leaderboard and golfer scorecards display the appropriate to-par or
skins units. Ball Drop scorecards show one saved team-to-par row below the golfer
rows, with shaded N/G markers on the two counting scores per hole. Positive
team scores use a plus sign; pending/unavailable scores are never zero.
Competition teams split across playing groups remain separately identified,
including how many members are shown. Existing round-game purse place prizes
rank these same saved metrics and split team awards among members, with existing
tie/remainder/projection rules. This is not a per-skin money transfer.
Skins leaderboards omit golfers with zero awarded skins from standings and
search/pages; pending and unavailable results remain explicit. This is display
filtering only, not a change to awards or purse calculations.
Overall Stableford selection accepts only Stableford games; remove a selected
binding before converting that game to Ball Drop or Skins. Legacy Stableford
definitions/results remain readable without migration and retain their existing
points tables and allowances.

### Nines

**Nines** is a three-golfer game for one saved playing group of exactly three:
5 / 3 / 1 points per hole, ties share their places (4/4/1, 5/2/2, 3/3/3), and a
pickup, `X7` or DNF ranks worst. Choose gross, or net with full Course Handicap
or strokes off the lowest golfer in the group. An optional stake per point
settles the point differences once for the group; blank plays for points only.

A Dots game can link to the Nines game, like Dots linked to Wolf. Choose
**Link to Nines** in Dots setup for the same group of three. Each golfer plays
alone, so specials follow individual Dots rules (no Assassin, no automatic
Sweep). Nines points and Dots add up to one combined total, settled once at the
Nines stake per point, and the leaderboard offers the combined standings.
See [game rules](docs/game-rules.md#supported-games).

### Round Stroke Play, Match Play, Nassau and Wolf

Stroke Play, Nassau and legacy Wolf version 1 use the shared round editor, captured
personal tees and acknowledged online scores. The API advertises
`supportedGameKinds`; older APIs without an explicit new-kind capability cannot
authorize new definitions or declarations. No local drafts enter saved results.

**Stroke Play** is individual gross or net, defaulting to full captured CH with
an explicit saved-group-low SO option and no points/allowance controls.
Cards show actual strokes;
standings rank lowest cumulative relative-to-personal-par, consistent with overall
Stroke Play when tees have different pars. Pickup, `X7` and DNF invalidate a
numeric stroke total rather than inventing penalties. Pending holes, missing net
inputs and arithmetic overflow remain distinct from zero.

**Match Play · With presses** is a separate version-1 game for either a 9-hole
or 18-hole captured round, including front/back nine selections. It has one
match stake per side, not Nassau's three bets. Singles, three-way individual
pairings, 1v2 best ball, and 2v2 best ball/aggregate use the same explicit saved
group and personal-tee handicap rules below. The match follows that group's
actual starting hole for one complete captured circuit, including printed-hole
wraps; presses follow that order, not a fabricated next printed hole.
Setup requires an explicit `match-play` API capability. Ordinary event owners
and collaborative Quick-round setup retain their existing management scope;
public scoring does not grant ordinary-event Match Play setup authority.
Group and individual scorecards can select Match Play to show cumulative
`UP` / `AS` / `DN` positions beneath each participating golfer's saved strokes,
plus the current match position above the card. Positions use saved server
hole outcomes in actual playing order, including wrapped nine-hole circuits;
missing or unavailable earlier results never produce invented later positions.
Each three-way pairing remains separate. These are main-match positions, not
press totals, individual game points or money; presses stay in Games.

**Nassau** is match play over an 18-hole captured layout, with independent front
1-9, back 10-18 and overall matches. Choose singles 1v1, three-way individuals
(three separate pairwise Nassaus), 1v2 best ball, or 2v2 best ball/aggregate.
Select explicit sides within one saved playing group. New net definitions offer
full captured CH or SO off the lowest in the **entire saved playing group**.
Unmarked saved matches retain their original match-participant-low rule.
New Nassau follows the shared starting-hole circuit while retaining printed
Front/Back membership; old proofs and printed-order definitions are preserved.
An ineligible numeric side is unavailable; explicitly concede or halve a hole
without fabricating strokes. Tied bets push, with no carryover.

Enter USD stakes explicitly or choose **No planned money**. Each stake is the
total per side, not a per-golfer multiplier. Teammates share equally in exact
minor units; indivisible cents remain unallocated. Amounts are planned, never
collected or transferred. Nassau has its own bet ledger, not a place-based purse
metric or overall Stableford source. Match Play likewise has an independent bet
ledger, never a place-prize metric. Its single stake uses the existing overall
minor-unit slot with front/back stakes fixed at zero. Existing Nassau games
and receipts are never converted or relabeled.

Manual presses use acknowledged two-down positions, start on the next hole and
inherit the parent's ending hole/stake. Optional automatic two-down presses fire
once per bet, without rearming after recovery; a press may itself be pressed.
Stage a manual press on its starting hole with the ordinary **Save & Next**
action. Earlier score/input corrections can make its receipt stale; preserve it
for review rather than silently accepting changed eligibility or money.
Match Play and Nassau share the game-ID-bound match declaration transport;
distinct game kinds and proof prefixes prevent exchanging their receipts.
Legacy raw-only saves preserve these extras, and legacy tester views continue
to omit both games' declarations, ledgers and stakes.

**Legacy Wolf / PIG (version 1)** selects one saved foursome with explicit
Wolf order, rotating from
that group's starting hole. Wolf tees last and selects a partner immediately
after that golfer's drive, before the next drive. Best ball compares two versus
two, or the lone Wolf versus three. Net uses 100% captured CH off the lowest
foursome member. The app uses these custom names and zero-sum transfers.
Cells list Wolf-side / opponent dots; solo Wolf numbers are totals:

| Declaration | Wolf side wins | Wolf side loses |
| --- | --- | --- |
| Partnered | +2 each / -2 each | -2 each / +2 each |
| Blind Wolf: after drives | +6 / -2 each | -6 / +2 each |
| PIG: before any tee shots | +9 / -3 each | -9 / +3 each |

Ties earn zero with no carry. Rank by **dot balance**, not Churchie earned dots
or handicap stroke indicators. There are no birdie bonuses, partner-refusal rule
or per-dot dollar settlement, and no second pairwise settlement calculation.
An explicitly configured existing place-based purse prize may rank the saved
balance; it does not convert ledger dots into cash.

Wolf waits for the foursome's saved dispositions, excludes pickup/DNF from
numeric best balls and reports a side without a numeric ball as unavailable.
Explicit match outcomes remain separate from raw strokes. Mode/partner choices
lock once saved. Timing is honor-system: an initial choice added after existing
raw scores is permitted for recovery but visibly marked late by the server.

Configure Nassau/Wolf before the round's first saved score; their definitions,
order, sides, stakes and press settings then lock. Other games remain editable
while these unchanged definitions are retained. Stale unstarted assignments
must be repaired before the first score. Declarations share conditional,
idempotent score/card/event/grant checks and immutable audit receipts. Legacy
raw-only clients preserve them; legacy tester projections omit these match
ledgers/declarations and cannot submit new ones.

### Independent Dots and earned Wolf

**New Wolf games use version 2. Existing version-1 games are not converted**,
even when unstarted. Their saved choices, signed transfer balances and old
results keep their meaning. Dots is an independent game, not a Wolf preset
or an extension of Churchie. The two engines consume a neutral hole-side context
only when explicitly linked.

New Wolf uses **earned dots**, never negative transfers. In partnered play,
Low compares each side's lower net ball and High its higher net ball; each
winning teammate earns 1 for each contest. Split High/Low gives everyone 1.
Ties earn zero with no carry. Pickup/DNF loses High to an all-numeric opposing
pair, while its remaining numeric partner can compete for Low. Unsupported
no-numeric comparisons stay unavailable, never invented penalties.

Blind Wolf after the drives is one solo best-ball contest, earning **2 per
winning-side golfer**. Pre-drive PIG earns **3 per winning-side golfer**.
There is no High contest for a solo hole or multiplication by opponent count.
Net uses 100% captured CH off the lowest foursome member and personal tees.

Earned Wolf has an optional **High/Low Sweep** setting, off by default. If the
same partnered side wins both High and Low, each winning teammate earns one
extra dot. Solo holes, ties and split wins do not qualify; no carry, stake or
category multiplier enlarges this bonus. A legacy linked Dots High/Low Sweep
must be removed or explicitly changed to manual before enabling the Wolf option,
so the same automatic bonus is never awarded twice.

The trailing golfer becomes Wolf for both final played holes: select after
16 played holes in an eighteen-hole round, or 7 in a nine-hole round. Use
Wolf plus explicitly linked prefix specials, with the next printed rotation
position breaking ties. Follow the actual starting-hole circuit: starting on
10 means choosing after 7 for holes 8/9. Freeze the acknowledged decision when
the final-hole declaration is saved. Earlier corrections update totals and flag
changed evidence but never rewrite the saved Wolf role. The most-turns
alternative is not implemented.

**Dots** supports standalone individual or fixed-partner play at x1, or an
explicit link to earned Wolf. Without a link, it keeps its own selected context
and settlement; creating another game does not silently attach it. Linked
specials use the current Wolf sides and x1/x2/x3 multiplier for both sides.
Each golfer's achievement shares its full award with current teammates;
Walk, selected Pickup and failed called challenges award opponents instead.
Individual Dots supports every golfer in a saved playing group of **1–4**.
Two or three golfers always play individually, never as teams. Solo play
records scores and specials without money or imaginary opponents; its rate
must be blank or zero. With two or more golfers, opponents are the other
actual participants. Fixed, rotating and Wolf-linked modes still require four.
Smaller individual groups require explicit API capability support; older APIs
retain four-player individual editing only.

New rotating Dots games use **version 2** for **Modified Sixes** (partners every
three played holes) or **Sixes** (every six). Choose P1–P4 on the first played
hole and save that order with the score. Pairs cycle P1/P2 vs P3/P4,
P1/P3 vs P2/P4, P1/P4 vs P2/P3. The pairings repeat in blocks of the chosen
length through the playing circuit.
Until an order is acknowledged, sharing stays pending rather than guessing
partners. The receipt fixes the cycle's first hole even after raw corrections;
an absent order recovered after scores is server-marked late. Once saved,
the order cannot be replaced or removed by clearing scores/specials.
Past earned dots stay with their original recipients when partners change.
Existing version-1 games are never silently converted.

These are rotating **special-dot sharing** formats, not a separate Sixes
match-points engine. They do not invent base High/Low contests or extra bets;
an explicitly declared manual Sweep is an independent special.
Their multiplier is x1 and their foursome settles independently.

Select enabled specials and whole-dot units before scoring. **Dots common**
selects every available special for the current mode/API, just like **Select
all**, preserving existing custom units. Unsupported choices such as individual
Assassin are not newly selected. Defaults are 1, except Birdie 2 and Eagle 5.

Coexistence checks apply to the **source golfer and whole hole**, not to the
teammate receiving shared dots. Chippy and Pully cannot coexist for one source.
Seve cannot coexist with that golfer's KP or Long Drive qualification; Sandy
cannot coexist with that golfer's KP on a captured default-tee par 3. Category
winner and second-qualifier selections are checked, not historical carried
ownership. **Seve with Blue Plate or Gorilla is explicitly allowed**.
Current score entry disables invalid additions and keeps saved choices
available for explicit repair. A score correction cannot newly invalidate
saved score-qualified claims without repairing those claims in the same save.
The entire group intent is checked before any score write, and the API checks
the same source restrictions against current saved inputs. Existing invalid
historical claims remain readable; unrelated peer edits do not silently repair
or erase them.

New clients negotiate `dotCoexistence=2`; supporting round responses advertise
`dotsCoexistenceRulesVersion: 2`. This is write-validation support, not a new
award calculation. Unsupported affected writes require an app update before
mutation; unaffected older reads and valid writes remain compatible. Churchie
v3 shares these restrictions; legacy Churchie v1/v2 retains its saved rules.

Score-qualified specials use gross qualifications:

- Hogan, Seve, Sandy, called Paree, called Murphy, Haz Par and Chippy allow
  par or better. Hogan/Seve use GIR/missed green on par 3s, without a fairway
  condition; par 4s/5s retain the fairway condition.
- Count each qualifying fairway or greenside bunker separately. Three bunkers
  can earn three Sandys. A separately called Paree can additionally award for
  the same fairway bunker. Called Paree/Murphy/Pully Murphy have pending,
  successful and failed outcomes; failed calls award the opposing side.
- Pully requires a long putt for gross par or birdie. Called Pully Murphy still
  requires its long gross par putt, needs its own call and may stack with
  Pully/Murphy. A birdie may also earn a manually confirmed Hogan when the
  fairway/GIR conditions are met; Birdie never invents Hogan. SuperDime replaces
  Dime. Gorilla is a personal par-5 green in two regardless of final score.
- New or changed declarations reject Hogan with Seve, Pully with Dime/SuperDime,
  and Hogan with Murphy/Chippy for the **same qualifying golfer and hole**.
  Different teammates may earn different specials and share them normally.
  Hogan/Seve with Walk is a review warning, not a prohibition.
  Historical version-1 inputs remain readable; these new checks do not silently
  erase saved calls/awards or rewrite legacy results.
- A failed Paree, Murphy or Pully Murphy cannot coexist with the same golfer's
  par-or-better specials or made calls on that hole. This includes Hogan, Seve,
  Sandy, Pully, Haz Par, Chippy and actually earned Birdie/Eagle/streak awards;
  Dime/Sticky and SuperDime are also incompatible with a failed call.
  Controls explain and block conflicting additions/outcomes without deleting
  saved choices. The API checks new/changed inputs too. Teammates' independent
  source awards remain separate, and old conflicting records stay readable for
  explicit correction rather than silently changing historical results.
  Score-derived **birdie-target Murphy** is target-aware: a missed
  birdie call followed by gross par may still earn a qualifying Sandy and Pully.
  Finishing over par or picking up does not make those claims valid.
- Birdie, Eagle and streaks derive from saved scores. Eagle does not also earn
  Birdie. String starts on the third consecutive gross par-or-better and awards
  again on every qualifying hole afterward. BirdyString uses three consecutive
  birdie-or-better scores, including eagles. When both configured streaks qualify,
  award BirdyString only; the underlying par-or-better run stays alive so a later
  par resumes String immediately. Other Birdie/Eagle awards remain independent.
  Follow the actual playing circuit, including across the turn; missing scores,
  pickup and DNF never extend a streak. These corrected calculations apply to
  existing and future derived standings/planned winnings, without rewriting raw
  scores, captures or original audit receipts.
- Ordinary Dots on a supporting API uses the same **Paree called** and
  **Murphy called** controls as Churchie: outcomes derive from the source
  golfer's personal gross par, with optional birdie target and total **1×/2×/3×**
  Murphy stakes. Presses multiply configured units, never the hole's stake.
  Failed calls award actual opponents (none in solo play); Pully Murphy remains
  manual. Saved manual calls require explicit **Use score outcome**. Blank scores
  remain pending, raw corrections recalculate outcomes without rewriting calls,
  and older APIs retain manual controls.
- Dots KP uses par 3s; Blue Plate and Long Drive use par 5s. Select a qualifying
  winner or explicitly no qualifier on each eligible hole, never Skip.
  Categories carry independently to their next eligible played hole, with
  the eventual winner's current teammates and multiplier. Final unclaimed
  units stay unawarded, not paid retroactively or rolled into another round.
  In a partnered Assassin context, optionally select the second closest KP
  or Blue Plate qualifier, or second longest fairway drive. The second golfer
  receives no separate category award. Leave it Not relevant when unknown;
  no Assassin is inferred. Individual and solo Wolf contexts omit these controls.
- **Category Sweep** is automatic in ordinary Dots whenever Long Drive and
  Blue Plate are both enabled, including existing rounds. The same golfer must
  win both on the same par-5 hole; partners splitting wins, second qualifiers
  and historical carried ownership do not qualify. Award one extra dot to that
  golfer and current teammates, never multiplied by carries, category units or
  stakes. Missing decisions stay pending; no winner is invented.
  This is separate from the saved linked High/Low Sweep and Churchie Sweep.
  Current clients negotiate `categorySweeps=1`; current round projections and
  newly authored affected audit receipts carry `dotsCategorySweepsVersion: 1`.
  Unmarked old full/lean responses retain their original calculation context.
  Unsupported affected score/game/KP writes fail with HTTP 426 before mutation;
  reads and purse publications fail before publication whenever legacy
  recomputation would disagree. No alternate legacy totals are returned.
  Raw cards, captures, original audits, saved Wolf final-hole choices and
  stale purse tie decisions remain unchanged.
- King is an individual x1 round-end bonus per category. One golfer must own
  every eligible hole's award directly or through carry; final unclaimed
  awards prevent that category's King. Actual layout counts determine coverage.
  Assassin needs both closest approach qualifiers or both longest drives in a
  2-v-2 side. Each category is checked independently.
- **Sweep** in new ordinary Dots is scorer-declared, with configured whole units
  and normal current-teammate/context sharing. It does not require High/Low or a
  gross-par qualification. Saved linked automatic Sweep remains unchanged;
  **Use manual Sweep** is an explicit before-scoring choice, retaining its units.
  This is separate from the automatic category bonus and base-game High/Low
  Sweep, and does not change Churchie's configured Sweep.

Manual Dots Sweep uses `sweepRule: "manual-v1"`; Wolf's opt-in bonus uses
`highLowSweep: true` on version 2. Clients require `dotsManualSweep` /
`wolfHighLowSweep` capabilities and negotiate `sweepRules=2`; affected rounds
and new private audit snapshots carry `sweepRulesVersion: 2`. Unsupported
affected reads/writes require an app update before mutation or publication,
never alternate successful legacy totals. Unmarked old definitions and
immutable receipts retain their original meaning.

Thief and full Sixes match engines remain deferred. Shared setup presets are
available as copied configurations, not additional scoring engines. Dots cannot stack
with Churchie. A foursome chooses only one of the currently supported Wolf or
Churchie internal base games; different foursomes remain independent. Ball Drop
continues between four-person competition teams, not as pooled internal dots.

Game money inputs use **dollars and cents**: `1` means $1.00; `.50` or `0.50`
means $0.50. Existing stored cents are preserved exactly. New internal games
use USD; blank or zero means points-only, never an implicit positive stake.
Special unit counts are points, not money.

For `N` golfers with individual combined dots `d_i`, total `S` and a configured
minor-unit rate `r`, planned net money is **`(N*d_i - S) * r`**. `N` is two or
three for smaller individual games and four for existing partnered formats;
solo never settles money. This already
compares every opponent; do not settle it twice. At $1, `[6,6,1,1]` produces
`[+10,+10,-10,-10]`. Total to settle is the sum of positive balances, not total
dots or absolute net balances. Explicitly linked Wolf/Dots shares one rate and
one settlement, with separate base/special breakdowns. Incomplete money remains
provisional; nothing is collected, transferred or marked paid.

Counts, calls and category decisions stage below raw scores and save through
the same acknowledged conditional score write. Dots records live on the saved
group's first golfer card, not Wolf P1. Raw-only clients preserve hidden records.
Immutable private score/correction receipts retain original and replacement
award snapshots. Routine scoring requests use the versioned `format=lean`
transport: verbose award evidence is omitted from reads and save replies,
while server totals, money, capabilities, captured inputs and safe-write
receipts remain. Full legacy reads stay compatible for explicit investigation.
Duplicate derived players/contexts are omitted too; saved comeback copies
reference the unchanged canonical card receipt. Available pre-write proofs
remain intact. The client restores omitted derived fields for existing strict
coherence validation; it does not replace transmitted numerical results.
No mobile audit/evidence panel is mounted. A separately requested desktop audit
view is future work, not a new public history permission.

Explicitly linked Wolf + Dots has a combined leaderboard with separate source
subtotals and one authoritative net due/owed amount per golfer. Individual game
standings remain available; unrelated games and foursomes are never combined.
An event-wide first game such as Ball Drop remains the initial selection.
Tap a net result for its calculation; the rate/method detail is collapsed by
default rather than showing a competing payment total.

Setup uses compact aligned rows, normal checkbox visuals with large hit areas,
on-demand rule descriptions and **Select all** for the selected mode. Existing
custom dot values are retained. Automatic-rule checkboxes only choose which
rules are in play during setup; they are not score-entry chores.

During scoring, each golfer's **Dots** action sits under their score alongside
KP. Only enabled manual specials/calls need entry; Sandy has tap counters.
Churchie Sandy/Other counts also have touch steppers; custom count editing is
optional and preserves invalid draft text for correction. Partner labels
distinguish fixed partners, rotating blocks and saved Wolf sides.
**Par for blanks** fills untouched unplayed fields using each personal tee's
par, without overwriting saved scores, explicit clears, pickups or other
staged edits. It is an explicit draft action, never an automatic score.
Adjust exceptions and acknowledge the same Save & Next; no separate Dots save
or keyboard is required for the common path. Initial Sixes/Modified Sixes
partner order is above the score fields on the first played hole; once saved,
entry shows only the current teams, not editable order or a future cycle.
Group contests remain below score fields, separate from per-golfer declarations
and KP distances. The canonical order receipt and server-marked late recovery
remain unchanged.

The API advertises `dotsRulesVersions`, `wolfRulesVersions`,
`internalGamesSupported` and narrow
`canManageInternalGames` permission. Missing capability does not enable writes.
Rotating Dots requires advertised version 2; legacy individual/fixed/linked games
keep their existing version-1 behavior.
Public internal configuration in ordinary events remains pre-scoring and
cannot edit protected peer games or promote a public actor to organizer.
Legacy tester views omit these game ledgers and cannot author their declarations.
Archives remain owner-only read-only. No infrastructure or authentication
configuration changes are required.

### Event-wide skins

The organizer opens **Event-wide skins** from the saved event or event setup
and explicitly enables this independent version-1 competition. It does not
enable or replace the primary overall competition, create round games, or change
existing round Skins, KP or Churchie rules. Older APIs without the advertised
capability remain unsupported, not implicitly enabled.

Each hole competes only within its own round; awarded skins add across every
configured round (including nine-hole rounds). Lowest numeric **net strokes**
wins, using 100% captured Course Handicap and each golfer's captured tee and
stroke allocation. Only when net strokes tie, an actual **gross birdie or
better** on the golfer's personal par takes priority; among those qualifying
scores, lower gross wins. Equal qualifying gross scores remain tied. Gross par
versus net par remains a tie. There are **no carryovers**, even within a round.
Unplayed field entries keep the hole pending; pickup, X7 and DNF are ineligible,
not penalty scores. Missing net inputs are unavailable, never scratch.

The saved-results board uses compact golfer tickets with their saved position
and skins count. **View winning holes** expands only that golfer's won holes,
grouped by round with the same configured-order pastel accents as round cards.
This expansion uses the already-loaded summary and issues no API request.
Known zero provisional/unavailable golfers retain their explicit state without
an empty expansion or a fabricated rank. **View skins details** loads a separate
comparison view on demand. A numbered hole navigator shows the selected round's
saved statuses and one open comparison of gross/net strokes, personal par and
received strokes. Previous/Next wraps through captured holes, not assumed
eighteen-hole numbering. Tied-hole summaries show a compact count instead of
long lists; every golfer remains in the comparison. The table omits repeated
per-golfer outcome labels. Round/hole selection survives detail refresh and
retry; missing refreshed selections fall back to the first available input.
Shared canonical decisions drive both views; details do not introduce carryovers
or new tie rules, and the winner cards are unchanged.
The public skins page keeps a **Back to event overview** link available while
loading, after errors and inside details. Round cards use one labeled SVG
scorecard link instead of a text-and-arrow action.
Mixed progress is provisional. Known zero winners are hidden only from complete
ranked displays, not underlying results or winnings. Refresh reads fresh,
coherent saved server data; drafts never count. Public visitors can read active
event results, while archives remain owner-only and legacy testers receive no
event-wide access.

Public skins requests opt into a versioned compact wire format that sends
repeated golfer/round identifiers once and encodes repeated rows positionally.
Strictly validated expansion restores the same saved results, including covering
golfers and pending/unavailable states; clients do not recalculate winners.
The summary loads once on entry; comparisons load only on **View skins details**.
Round/hole filtering and returning to the board do not issue extra requests.
Older expanded API responses and existing digest continuations remain supported.
An automated twelve-golfer/five-round numeric fixture measures uncompressed JSON
at 6,005 bytes for the board and 28,548 bytes for details, versus 24,665 and
175,121 bytes previously. These are fixture measurements, not live timings or
limits on event size. Details skip unrelated overall/duplicate skins calculations.

In the purse editor choose **Event-wide skins · pot per skin won** and enter
an explicit amount in the event currency. There is one canonical event skins
pot, with no default stake, budget increase or reallocation from other pools.
Divide its minor units by actual awarded skins, floor once per skin, then
multiply by each golfer's wins. A 100.01 pot over three skins awards 33.33 per
skin and leaves 0.02 unallocated. With no winners, the whole pot stays reserved
for a later organizer decision. Pending holes mean an unknown final denominator:
shown shares are projected, never guaranteed or paid. Disabling the competition
retains its pot as an unavailable source for repair, not zero winnings.

### KP Competition

Open a saved round's **KP** tab. Its organizer can configure one KP competition,
including on an already-scored round, without unlocking ordinary setup inputs.
Eligible holes and monetary cent priorities come only from the saved **default**
tee's par 3 layout, even when golfers have personal tees. No par 3 means unavailable.
KP is separate from game points, handicaps and overall standings.

On eligible holes, **KP** beside a golfer stages whole feet/inches (inches 0–11)
and requires explicit confirmation that the ball finished on the green. Explicit
0 ft 0 in is a hole-in-one; blanks never imply zero. Only the group's closest
contender needs a measurement. Other golfers may remain blank or use
**No measurement**, which does not mean missed green. Multiple contenders are
retained and compared round-wide. Entries can also be edited afterward in KP
review. Clear, measured and No measurement edits use the same conditional,
audited score write as strokes/Churchie, including distance-only edits. Save must
be acknowledged before advancing; drafts are online-only and never persisted
in browser storage. Discard clears all local round drafts, not saved entries.

Selected-hole KP review uses aligned golfer/measurement rows. Closed or
read-only entries show plain distances, **No measurement**, or **Not entered**,
not disabled editing buttons. Open, authorized entries use compact edit
controls. Save/Discard appears only while round drafts exist; conflict recovery
and discard remain available if entries close with unconfirmed drafts.

Each KP hole uses a compact pin ticket: the closest saved golfer(s), distance
and applicable award are visible without repeating the full field.
**View contenders** expands all measured entries in distance order; its plain
count and chevron change to **Hide contenders** when open. Ties remain explicit,
and resolved awards feature the actual selected recipient(s). Open entries show
leaders, not settled winners. Allocated versus projected amounts stay distinct;
unknown measurements never become zero, and zero inches remains a hole-in-one.
Owner tie controls retain their existing conditional-save workflow.
Once a tie is resolved, its organizer controls remain available under
**Change tie resolution** instead of occupying the whole ticket.

The organizer explicitly **closes KP entries** to establish final contenders,
and can reopen for corrections. This does not finalize, lock or unlock ordinary
golf scoring. Public/legacy score writers cannot configure, close or resolve ties.
Closed KP rejects changed distances, including stale clients; raw-only score
edits preserve KP. Archived views remain owner-only and read-only.

In the event purse editor, add a **KP Competition** source for the round.
Its unsaved default is **100.00 in the plan currency**, one pot shared with the
event budget, never extra money per player/hole or automatically added settings.
While entries are open, the pot stays reserved. After closure, divide the entire
pot equally among holes with qualifying measured contenders. A golfer winning
two holes receives two shares. Empty holes are excluded; an all-empty day stays
fully unawarded for organizer review, with no rollover.

Remainder cents go to the longest **winning** default-tee hole first, then the
harder stroke index (lower is harder). Missing/ambiguous required inputs block
final allocation. Exact closest-distance ties require the organizer to select
one tied golfer or split among all tied golfers. Split remainder cents require
explicit recipient selections. Decisions bind to current measurements and hole
amounts; edits invalidate stale awards. Unresolved ties cannot claim fully
allocated money. These are planned winnings, never payments or transfers.

### Estimated round differentials

Round scorecards offer a collapsed **Round differentials** control for the
all-golfer summary. Individual cards have a collapsed **Estimated differential**
control. Both are optional and closed by default, keeping the scorecards in view.
These are **18-hole estimates with PCC 0**,
not official GHIN results or handicap submissions. A player needs all 18 saved
numeric scores, usable captured personal-tee ratings/allocation and captured
handicap inputs. Missing scores remain pending; pickup, X7, DNF, missing inputs
and arithmetic errors never become invented numeric differentials.
Missing values display **—**, without per-row explanations. Columns use
**Adj. Gross / Est. Diff.**, shortened to **A.G / E.D** in narrow containers;
accessible column names retain their full meaning.
The small header info icons reveal only **Adjusted Gross** or
**Estimated Differential** on tap, without adding routine explanation rows.

Adjusted gross caps each numeric hole at net double bogey using the golfer's
full captured Course Handicap and personal tee. The estimate is
`(adjusted gross - Course Rating) * 113 / Slope Rating`, rounded to one decimal.
For adjusted gross 88, rating 72.0 and slope 130, it is **13.9**.
The adjustment is calculated separately; raw strokes and competition results
are not rewritten.

Official [USGA Rule 5.1a](https://rulesworkshops.usga.org/content/usga/home-page/handicapping/roh/Content/rules/5%201a%20Calculation%20of%20a%20Score%20Differential18Hole.htm)
also includes the Playing Conditions Calculation, which this app does not fetch.
[Nine-hole WHS differentials](https://rulesworkshops.usga.org/content/usga/home-page/handicapping/world-handicap-system/2024-revision/2024-treatment-of-9-hole-scores-FAQ.html)
need an expected-score component; this feature does not guess it or apply the
18-hole formula to nine-hole cards. It does not update Handicap Indexes,
determine handicap-posting eligibility or retrieve GHIN records.

### Churchie

New games use **version 3**. The displayed game is Churchie; the internal
`churchy` identifier remains compatible with saved data.
New net games default to full captured CH and can explicitly select whole-group
SO for High/Low. All specials and calls remain personal gross.

Choose the partnership method before scoring:

- **At the tee:** explicitly arrange P1–P4 in setup and review the pairings.
- **After approaches:** choose closest, farthest and next farthest in score
  entry on the group's first played hole. The fourth golfer fills the remaining
  position. Golfers decide the ranking, including ties; no distance is inferred.

For approach order, positions 1–4 mean closest through farthest. Both methods
use 1+4 versus 2+3 for the first three played holes, 1+3 versus 2+4 for the next
three, then 1+2 versus 3+4. Repeat for the next nine played holes. Partners,
1/2/3 stakes and carry processing follow the group's actual starting hole and
playing circuit, including back-nine and wraparound starts.

Approach order is saved once on the canonical group-first card and cannot be
reshuffled after acknowledgement. Another group's first score does not prevent
this choice. Raw scores may be saved while order is pending, but partners and
money are not invented. Recovery after scoring is server-marked late; clearing
specials or raw-only edits preserve the original order.
Once the order is known, score entry shows the selected hole's current matchup
directly as **Golfer A + Golfer B vs Golfer C + Golfer D**, rather than a collapsed
partner schedule. It follows the saved playing circuit when navigating holes;
pending teams and late-order recovery remain explicit.

Version 3 shares the Dots specials catalog and configuration editor. Its
**Sticky is Dime**, not an additional award. All compatible specials can be
selected with positive whole-dot units. The Churchie default selects the familiar
subset, with Birdie 2, Eagle 4 and other default units 1.
KP and Blue Plate are enabled by default at 1 dot: KP is open
on default-tee par 3s and carries to the next par 3 after an explicit No qualifier;
Blue Plate is the closest qualifying GIR on default-tee par 5s and carries to
the next par 5. Their carries are independent and follow actual playing order.
The eventual winner and their current partner each receive the full carried
award, entered once for the winning golfer, never split or credited twice.
Missing input remains pending, not No qualifier. Existing saved definitions
and Other entries are never changed by a new default.
Sandy now allows gross
par or better. Shared same-golfer exclusions apply, including Sticky/Pully and
Hogan/Seve; SuperDime replaces Sticky. High/Low remain Churchie's own game.
The same failed-call/par-or-better compatibility rule applies to current shared
Churchie specials; correcting an old conflict is explicit, never a read-time
rewrite of saved cards or awards.
Murphy press stages multiply its configured units by 1/2/3; Sweep multiplies its
configured units by the current stake.

On a target-aware API, **Murphy called** records the call, not a claimed outcome.
Gross par or better makes the default target; **For birdie** on personal par 4/5
holes requires birdie or better. Blank/invalid entry stays pending; pickup/DNF
misses. The +/− stakes control stops at **1× / 2× / 3×**. Correcting a saved raw
score recalculates a target-aware call without another declaration write.
Existing manual calls retain their saved result until explicit **Use score
outcome**, target change or removal; merely opening a card never converts them.
Older APIs retain manual controls, and older clients receive compatible reads.

On a Paree-aware API, **Paree called** similarly derives made/missed from gross
par or better, without an outcome dropdown, birdie target or press multiplier.
Missing scores stay pending; worse numeric scores, pickup and DNF award the
configured Paree units (normally one) to the opposing side. **Add another Paree
call** retains separately called repetitions. Manual saved Parees require
explicit **Use score outcome**; no old result is silently converted.
Unchecked called controls have one outline; expanded controls retain grouping.

**Specials and presets** is collapsed during setup. Built-in Dots and Churchie
presets provide different default units; applying one copies settings into the
game and never changes other saved games. Named custom presets are saved in
this browser/device only. They store enabled specials and units, not scores,
player/game IDs or money. Blocked, corrupt or full storage produces an explicit
error without dropping the draft or overwriting unread presets.

Creation/edits require advertised `churchyRulesVersions` containing `3`.
Unstarted version-2 games offer an explicit **Use updated Churchie rules**
action, preserving the initial partnership sequence and selected legacy specials.
It is a conditional, audited change; scored games and version-1 games cannot
be converted. Ordinary Dots' new Other option requires advertised
`dotsSpecialKinds` support; missing capability retains the legacy catalog.

#### Legacy versions 1 and 2

Existing version-2 games and version-1 games retain their
original awards, saved declarations and settlement; editing a saved game does
not convert it. Each saved foursome can have its own independent Churchie game,
with separate settings, carries, standings and money. A foursome cannot stack
Churchie with Wolf or separate Dots. Ball Drop remains a separate
between-foursomes competition and can coexist with these internal games.

Before scoring, choose the playing group, explicitly order P1–P4 and toggle
the named specials in play. Their agreed values are fixed, not a custom points
editor. Public pre-scoring internal-game permissions apply; this does not
grant general event, catalog or purse management. Saved group, order and special
settings lock once round scoring starts, without unlocking captured setup.
Partners are P1/P2 versus P3/P4 on holes 1–3, P1/P3 versus P2/P4 on 4–6,
and P1/P4 versus P2/P3 on 7–9; these repeat on 10–18. Stakes 1, 2, 3 repeat.
The group's starting hole changes navigation, never the scoring sequence.

High compares each pair's maximum **net numeric strokes** (lower wins);
Low compares its minimum (lower wins). Churchie subtracts the lowest captured
Course Handicap of the four from each handicap and allocates relative strokes
using each golfer's captured personal tee. Absolute CH labels and other games
are unchanged; NH or unavailable allocations never become scratch defaults.
High/Low carry independently across partner changes and the turn. A sweep
awards only the current stake; final tied carries remain unawarded.
Earlier pending scores block subsequent carry awards.

The current-hole Dots action opens a keyboard-accessible dialog without
opening the score keyboard. Paree (fairway bunker) and Murphy
(chipping) require explicit calls: gross par or better wins for the calling
pair, otherwise the opponents win. Murphy stages are initial 1, opposing-team
press 2, calling-team press-back 3, with no further presses or verified
individual attribution. Sandy requires confirmed greenside up-and-down at
exact gross par; multiple qualifying Sandys can be recorded for the same golfer
on one hole. Pully requires a confirmed par or birdie putt longer than the
flagstick. This applies to both Churchie versions without changing their
separate points schedules or settlement formulas; Sandy still needs exact par.
Enabled exact gross Birdie earns **2** automatically; Eagle earns **4** instead,
never Eagle plus Birdie. **Sticky** is a scorer-confirmed approach inside the
flagstick length, worth **1** without extra score qualification or measurement.
**Other dots** accepts whole-number units per hole, with no required reason.
Record each source award once: both current partners receive its full units.
Other dots remain a catch-all rather than a round-level adjustment.
The existing Paree/Sandy/Pully values and Murphy stages remain fixed.
Disabled named specials have neither entry controls nor automatic awards.

Both winning partners always earn the full dots, **never netted or negative**.
Pickup/DNF loses High to an all-numeric pair, while its numeric partner still
competes for Low. Called Paree/Murphy is missed on pickup/DNF. Both pairs
incomplete for High, or either pair without a numeric Low, remain explicitly
unavailable: no invented tie/penalty, final total or settlement. X7 is a pickup
with reported seven, not completed numeric seven. Missing scores are pending.
Score and special metadata share the same conditional, idempotent audited
write. Specials-only changes, retries, discard and navigation guards use the
existing score-draft workflow; nothing persists offline.

Version-2 standings show earned dots and **net due/owed**, with **Total to
settle** and an optional opponent-by-opponent explanation. At USD rate `r`
in integer cents, each golfer's planned balance is `(4*d_i - sum(d)) * r`.
For `[6,6,1,1]` at $1, balances are `[+10,+10,-10,-10]`; total to settle is
$20, not the sum of absolute balances. Enter dollars (`1`, `.50`, `1.25`),
never raw cents; zero means points-only. Pending money remains projected and
unavailable inputs/overflow never become zero.

Legacy version 1 keeps one-dot exact Birdie, no Eagle/Sticky/Other or repeated
Sandy fields, and its original shared-pot formula `2*d_i - sum(d)/2`.
For example, `[21,21,0,0]` at $1/dot still means +$21/+$21/-$21/-$21.
The cleaner presentation does not rewrite these legacy rules. Neither version
collects or pays money, supplies overall Stableford or funds place-based purses.

Set API `CHURCHY_GAME_ENABLED=false` to hide all Churchie setup, entry, cards,
results, standings and settlement and reject Churchie-specific edits. Saved
definitions, special metadata and audits survive; ordinary strokes and other
game edits still work without erasing hidden data. Absent configuration enables
the **new API**; only exact `true` explicitly enables, while other configured
values fail closed. The UI requires an explicit server `churchyEnabled: true`;
missing capabilities from an older API never authorize new Churchie writes.
Version-2 creation and edits also require advertised `churchyRulesVersions`
containing `2`; the general flag alone does not establish version-2 support.
Deploy the compatible API before exposing the new UI. No live setting or
deployment is performed by this implementation.

### Round leaderboard

Open **Leaderboard** beside Scorecards, Enter scores and Games. Select a saved
game to rank golfers or its configured teams by server-derived totals:
Stableford points and Skins awards highest first, Ball Drop team-to-par lowest
first. Holes scored and complete/in-progress
states stay visible; mixed-progress standings are explicitly provisional.
No projected totals, raw-gross ranking or client-side handicap recalculation
is used.

Equal points share positions (`T1`, `T1`, `3`); roster order within a tie is
not a tie-break. No countback or final winner is selected. Known zero and
negative points remain valid scores. Golfers without scored holes wait outside
the ranks, and unavailable results show their reason rather than a zero.
Game selection survives view changes and refreshes. Unsaved strokes or game
settings are not used in standings, and viewing never saves anything.

The leaderboard uses the authorized online score projection and its
refresh/backoff/access checks. Everyone can view active events; archived
rounds remain owner-only and read-only.

### Optional overall event leaderboard

Organizers can enable one **overall event leaderboard** in event setup, alongside
the independent round leaderboards. It covers every configured round, not a
fixed five. Existing events remain disabled until explicitly configured.
Adding a round adds a standings column; missing setup is shown explicitly,
never silently omitted or counted as zero.

For **Stableford**, select one saved counting game per round. The event total
sums those games' actual points unchanged, including Standard/Modified/custom
rules. For team rounds choose either each golfer's individual component points
or the full team's points credited to every member. Multiple daily games are
never added together implicitly. Highest cumulative points leads.

For **stroke play**, choose gross or net. Net allowance is configurable with the
existing individual default of 95%; calculations use each round's captured
tee and Handicap Index, not current catalog values. Live positions use cumulative
score relative to par on completed numeric holes, lowest first, with progress
shown. Raw incomplete stroke subtotals are not used to rank golfers.
Pickup, reported pickup (`X7`) or DNF means no valid stroke-play total until
corrected; no penalty strokes or maximum score are invented. Team-point credit
does not apply to stroke play.

Player rows show dynamic round results and the cumulative total. Known zero and
negative results are retained; equal results share positions without countback.
Unplayed holes are pending and live standings provisional. Missing configuration,
unavailable net inputs, stale team assignments and arithmetic-range failures
remain explicit rather than becoming zero or a fabricated valid rank.

The overall view is online and available to owners and public active-event
readers. A bounded server read
derives standings from saved cards/game results and verifies event consistency;
each round consumes the existing score-read quota. Unsaved score/settings drafts
are excluded. Archived owner views are read-only. This is not finalization,
handicap posting or automatic payout. Purse allocation is configured separately.

### Local catalog and round setup

The explicitly bootstrapped organizer manages the private reusable course and
player catalogs. Being an event owner or signing in does not grant catalog
search/import/edit rights. Participants receive only authorized event-local
course and roster projections, never the global player directory or its index
history.

Both catalogs use compact searchable rows and a focused add/edit panel.
**Add course** opens the export, review/stage and explicit publish workflow;
**Update** binds the export to the chosen course. Version IDs and import
identifiers live under technical details rather than on every row.
Closing an import retains its local draft and selected preview on this page.
Catalog search waits for every bounded directory page; interrupted reads retain
their loaded rows and cursor, and **Refresh** continues loading before search or
editing is enabled. No partial list is presented as complete search results.

Course import validates the supplied export and stages metadata plus each
independently identified tee-rating profile before publishing an immutable
version. Matching names/colors do not merge source categories, hole definitions
or ratings. Repeating an import is idempotent; an authorized changed import
creates a new version, not an overwrite of an existing round. Saved courses are
reusable without the original file or a live provider. Source attribution and
an unknown export date are not a claim that ratings were freshly verified.
Explicit `null` values for `IsShorter` and `EligibleSides` are retained as
unknown metadata, not changed to `false` or `"All"`. Other types, missing fields
and invalid hole/rating totals remain validation errors. Older populated
metadata remains valid; no saved-version migration is needed.
Expand a tee profile in the import preview or saved-version view to inspect its
hole yardage, par, stroke-index allocation and Total/Front/Back ratings after
choosing **Preview tee**. Only the chosen profile is displayed; no tee is selected
automatically. Previewing a profile does not select it for a round or reduce the
set of profiles validated/staged/published by an import.

Players are independent of sign-in accounts and event membership. Manual index
observations have effective dates, source labels and audit history. Unknown is
not zero, and plus-index notation is preserved without calculating handicaps.
An optional starting index can be entered when creating a player; the player
and first audited observation are saved together. **Add player** starts with a
name and optional HI; date/source fields appear only when an HI is supplied.
New manual observations default to today's local date and **GHIN** as the source
label; neither field needs editing for a normal update. Historical dates and
other manual sources remain available in the catalog editor. This is manual
entry, not an automatic GHIN lookup or verification.
Catalog and Quick-round player lists sort by last name before pagination;
full setup keeps selected players first and sorts each selection list by surname.
Profiles store one display name, so sorting uses the final name component
(or an explicit `Last, First` prefix), ignoring common generational suffixes.
Single names sort as written; full name and ID break ties. Compound surnames
cannot be inferred reliably without structured names. This is display ordering
only, never a change to saved roster, playing-group or scoring order.
The focused player editor has separate **Profile**, **Handicap** and **History**
sections. Name and handicap edits remain separate conditional saves; section
changes retain drafts, and closing an edited player requires explicit discard.
Audit identifiers remain available under observation details. Closed creation
drafts can be resumed on the same page; catalog drafts are never stored offline.
Backdated observations remain in history rather than replacing a newer current
observation. Active rounds that have not started use the latest current catalog
observation, including NH when no observation exists. The first saved score
atomically captures all round indexes with the score, audit and setup lock.
Ordinary catalog changes do not alter started or archived rounds. Official index
verification/posting remains outside this increment.

On **The Group**, a signed-in catalog manager can tap a roster player's name
and change just their **Handicap Index**. Date and source are not fields in this
quick editor: they default to today/GHIN. Saving first records the catalog
observation, then conditionally applies that exact observation to this event's
unfinished started rounds. Their Course Handicaps and derived net results,
including already-saved holes, recalculate on fresh reads; raw strokes never
change. Completed rounds keep their saved HI, and unstarted rounds continue to
use current catalog HI. Completion means every golfer has a saved disposition
on every captured hole, including pickup/DNF, not a calendar date or formal
finalization. Other events are not scanned or retroactively corrected.

Catalog and event updates are separate acknowledgements. If the second step
fails, the editor explicitly reports that the player HI was saved, retains the
same event retry, and offers reload/review for a conflict. It never claims both
steps succeeded prematurely. Original captures, score locks and raw card
revisions remain intact; older scoring drafts must refresh corrected inputs.
Anonymous visitors, testers and ordinary event owners do not acquire global
catalog rights. Older APIs without the explicit capability hide the shortcut.

The manager's owner workspace distinguishes current unstarted-round inputs from
frozen started-round captures. An optional confirmed setup refresh can also
persist current observations for one unstarted round, preserving the previous
stored inputs in an audit record. No refresh is required to use current indexes
before scoring. Course/tee/group selections and global profiles are unchanged.
The roster shortcut is a narrowly authorized, audited HI refresh; ordinary
catalog updates never unlock or recalculate a started round.

An active event owner can open **Correct saved handicap, tees or groups** from
round scoring after scoring starts. This separate correction workflow keeps the
event roster and captured course/version fixed, but supports event-local captured
HI/NH, compatible common/personal tees, playing groups/starting holes and existing
competition-team assignments. A reason and explicit review are required in the
editor. Existing score/KP/game tools continue to edit saved entries across rounds;
closed KP must be explicitly reopened first.

Corrections are conditional, idempotent and privately audited. Changed indexes
receive new server-authored observations, never altered observation identities or
global catalog writes. Original capture receipts, raw cards and scoring locks
remain intact. Fresh canonical reads recalculate games, overall results, skins
and purse awards; stale KP/prize decisions require review rather than silently
receiving a new meaning. Scored Churchie foursome/order safeguards remain in force.
Score writes bind to the corrected input revision, so an older browser cannot
save a draft against changed captures merely because its card ETag still matches.
Failed or uncertain correction saves retain the draft and operation identity;
explicit discard/reload reads saved inputs before returning to scores.

Owner setup selects saved players and an explicit course version/tee for one
or more rounds, with positive numbered manual groups and at most four players per
group. Every selected player must be assigned once per round. Group choices
show their current counts and are disabled for additional players when full;
moving or unassigning a player frees a place without moving anyone else.
The **Create Group** option offers a new group without creating it until a
golfer is assigned; the round summary counts only existing groups.
Stale edits require refresh rather than silently overwrite another update.
Setup does not bind a player to an account, invite anyone, save scores or provide
offline sync.
The setup screen separates collapsible event details and player selection from
the selected round's editor. Player search keeps selected players visible;
course search retains the current choice without selecting a new version or tee.
Each round keeps its draft and version-load state when switching rounds. Adding
a round selects its new draft. The save bar applies the whole event draft, not
only the visible round; incomplete hidden rounds still prevent saving and are
identified in the checklist. Saved inputs and captured/current index comparison
are in a separate expandable review, never a preview of unsaved choices.
Saved, unsaved and scoring-locked round labels do not imply offline persistence.
Events support one or more golfers, with no application-imposed upper
golfer/team/group-count ceiling. Teams remain two or four, not larger Ryder Cup
sides; each team game still requires a complete roster of full teams.
Editors and results use search/paging without dropping off-screen
selections. Separate budgets of eight rounds, 16 games per round and 32 points
rows remain. Finite service safeguards still apply: staged logical writes are
limited to 4 MiB and private values to 32 MiB; oversized work fails explicitly.
This is not a promise of infinite memory, throughput or offline durability.
The local implementation and validation are not authorization for a deployment
or an actual private-source seed. Those remain separate release/import steps.

### Organizer-assigned per-golfer tees

The organizer can enable per-golfer tees at event level and assign a captured
tee for each golfer in each round. The common round tee is the default.
Choices come from the selected immutable course version and must have matching
hole numbers and 9/18-hole layout; par, distance, rating, slope and stroke index
may differ. There is no golfer self-selection or new participant permission.

Personal scorecards, stroke-to-par marks, blank-score par nudges, playing
handicaps, Stableford/team points and overall stroke standings use that golfer's
captured tee. Group views identify mixed tees rather than pretending common
metadata belongs to everyone. Once scoring starts, assignments stay locked;
the option cannot be disabled to reinterpret a scored mixed-tee round. Legacy
setup requests preserve existing choices, not silently reset them.

### Organizer purse and individual winnings

The public **Purse and winnings** page keeps one course/round's prize pools in
view with a dropdown, plus event-wide pools as a separate choice. Player award cards
show event-wide calculated awards and the pools won; known non-winners show
0.00 with no pools. Players sort by money won, highest first; ties retain their
existing order and unavailable amounts follow known amounts.
Projected amounts, funding reconciliation and editing
controls are omitted. Pending/unavailable sources remain identifiable.
The public API sends a dedicated summary, not full scorecards or setup inputs;
fresh reads and server-side scoring/permission checks are preserved.
Public overall and event-skins boards likewise request separate display-only
summaries, retaining authoritative points/ranks/progress without downloading
raw scorecards or the other board's results.

Each card shows the exact amount/currency, compact winning-pool labels and a
**View winnings breakdown** button. That action loads the existing on-demand
explanation: actual pool awards,
place/tie/team shares, KP winning holes/distances and skins count times the exact
per-skin rate. It contains no protected audit actors, edit history or projected
money. Newer totals are identified rather than pretending they match an older
player sheet. Requests are canceled on close or access/context changes.
The breakdown groups awards into separated table rows with right-aligned
amounts; pools with multiple entries show their saved subtotal.

A compact **Organizer review needed** notice appears above affected loaded
results for unresolved manual prize/KP ties, stale decisions/teams, unavailable
inputs, unassigned awards or an over-budget purse. Expand it for the affected
round/pool and action. Ordinary covered skins, automatically pooled ties and
future unplayed holes are not discrepancies. Notices reuse the page's canonical
read; they do not add background event-wide requests or claim to scan unopened
pages. Excel-readable export remains separate future scope.

Organizer tools retain the complete plan and calculation detail below.
The organizer winnings table shows all search matches without paging; recipient
selection in the editor retains its separate controls for larger lists.

Open **Purse and winnings** from the event overview or setup. Configure planned
fixed funding or a buy-in multiplied by the current roster, choose the event
currency, and add round/game place awards, overall place awards, KP round pots
or manual
side-pot recipients. Supported currencies are USD, CAD, EUR, GBP and AUD with
two decimal places and no currency conversion.

All winnings are attributed to individuals. A team pot is divided among winning
teams and their two/four members; an explicitly per-golfer team amount is labelled
and budgeted differently. Pooled ties split the combined occupied-place prizes,
or the organizer can resolve a tied entrant order for that award pool without
changing leaderboard positions. Indivisible cents remain explicitly unallocated,
never awarded through roster order.

Exact minor-unit arithmetic reconciles scheduled awards, calculated/projected
allocations, reserves, remainders, remaining budget and overcommitment.
Incomplete play stays projected. Missing sources, stale decisions and unavailable
results are not fabricated winners or zero balances; known partial shares remain
visible and invalid decisions can be repaired. The editor preserves drafts and
requires explicit conflict review. Configuration saves are conditional,
idempotent and audited; archived owner views are read-only.

Budgets are planned, not collected. Calculated awards are not payments,
transfers or round finalization. Larger competition sides and payment processing
are not implemented. KP has its separate explicit cent-allocation policy above;
existing place/manual pools retain their unallocated-remainder behavior.

A later UI migration is planned to **Fluent UI v9 and Griffel**, using
component-owned classes and named slots instead of generic tag selectors or
inline styling. Preserve semantic HTML, keyboard/focus behavior, themes and
mobile layouts. A related readability pass will simplify deep shared imports
and dense component/handler code without breaking NodeNext ESM resolution.
These follow-ups are tracked; no Fluent/Griffel dependencies are installed yet.

## Structure and dependency direction

```text
src/
  app/             Composition, hash navigation, global styles, co-located tests
  domain/          Readonly, framework-independent trip models
  contracts/       Runtime-validated network contracts, no provider SDKs
  client/          Browser identity and typed API adapters
  demo/            Fictional fixtures and fixture-invariant tests
  features/trip/   Explicit fictional Preview views and their own tests
  features/event-trip/ Saved-event Overview, Rounds, Group and their tests
  features/events/ Private Events presentation and co-located tests
  features/scoring/ Group entry and saved scorecards, with co-located tests
  test/            Shared test environment setup
tests/smoke/       Production-browser smoke tests
public/           Manifest and static icons
scripts/          Dependency-source checks and deterministic icon generation
.github/          CI and contributor instructions
api/              Independent Functions workspace, handlers/adapters/own tests
docs/             Architecture, security, provisioning and recovery boundaries
infra/            Test-only Bicep, parameter template and compiled-ARM checks
```

Dependencies flow from `app` into feature public exports and demo fixtures,
and from features/fixtures into `domain`. Presentation receives typed data through
props rather than importing demo data. Stateful catalog/setup controllers own
their cohesive workflow state and receive injected typed client interfaces;
`app` alone constructs the browser adapters. Controllers never construct
identity providers or fetch through a global service. This keeps these workflows
co-located instead of expanding the Events composition page with every form.
Domain models
do not depend on React, the browser, fixtures, or backend technology. Tests live
beside the code they exercise; only end-to-end checks live in `tests/`.
The API imports only shared domain/contracts, never UI/demo/client code.
Provider SDKs stay in concrete adapters; the browser never imports storage or
server credentials. No empty future layers or generic service framework exists.

The selected event is explicit in each live-tab URL; scoring navigation alone
is also remembered on the device. Opening an event links its Overview,
Rounds, Group, setup and scorecards without reusing demo models or fetching the
global catalogs for read-only views. Direct links restore the event context;
without one, choose an event rather than automatically taking the first result.
Organizer sign-out/session expiry clears private management UI. Public scoring
does not depend on that session. Organizer controls belong behind the header's
Organizer tools entry rather than in ordinary golfer screens.
Saved round cards distinguish **No scores yet**, **In progress** and
**Entries complete**, including playing-group coverage. A saved pickup or DNF
counts as an entry, but does not make an incomplete gross score complete or
finalize the round. Progress uses saved active-event scorecards, not local
drafts or the permanent setup-lock flag, and refreshes with **Refresh event**.
Loading or unavailable progress must not be presented as zero or complete.
Public workspace reads check active state and use allowlisted projections;
private legacy reads retain their membership checks. Setup writes keep their
owner-plus-catalog checks; game management remains event-owner only. Public
scoring does not create memberships, admissions or administrator grants.

## Local feeds versus public CI

On a managed machine, configure your approved internal registry in a local,
ignored `.npmrc` using your organization's supported authentication flow.
Do not copy credentials into this repo or change its CI to use a private feed.
`npm ci` uses the committed lockfile; npm can replace its public registry host
with your configured local registry. Do not retry public endpoints locally
when organizational policy blocks them.

For intentional dependency updates:

1. Select public open-source packages only; verify their provenance and license.
2. Run `npm install` using your approved local source.
3. Run `npm run lockfile:public` to replace feed-specific tarball URLs.
4. Inspect the diff, run all checks, and commit `package.json` and the lockfile.

Normalization is offline and preserves package versions and integrity hashes.
It does not publish packages or prove that a private package exists on npm.
Never use it to disguise an internal dependency as a public one. The independent
`check:lockfile` step rejects private sources, embedded credentials, URL query
parameters, and missing/malformed integrity hashes before CI installs anything.
GitHub Actions explicitly selects `https://registry.npmjs.org` with no corporate
feed credentials. A clean public-registry installation still needs verification
on the GitHub runner; a local cache-backed run is not proof of network access
or registry availability there.

## Continuous integration and deployment

Each push to a pull request runs CI once: locked installation, public-lockfile
checks, strict type checking, lint, named unit/component suites, production
build, and Chromium desktop/mobile plus iPhone WebKit smoke tests. Pushing a
branch without a pull request runs no checks; use **Run workflow** on the CI
workflow for that. Merges to the TEST and production branches run the same CI
as the gate of their deployment workflows. CI has
read-only repository permissions and uses no production secrets. It uses ordinary
`pull_request`, not privileged `pull_request_target`.

Hosted browser checks use the official Playwright image with browsers and OS
dependencies preinstalled, pinned to the locked Playwright version and an
immutable image digest in both workflows. Update those pins together with
Playwright. Only browser commands run in that container; local commands remain
unchanged and do not require Docker. Test packaging forwards its public build
configuration and smoke expectations explicitly.

Production deployment on `main` calls that same validation workflow and only
uploads the resulting verified `dist/` artifact after every check passes.
There is no second platform build or dependency installation during upload.
Ordinary feature branches and pull requests do not deploy or receive deployment
credentials. The separately approved, branch-restricted test environment has
its own frontend token and narrow API deployment identity; it cannot deploy
production. Manual production runs are also restricted to `main`. After upload,
the workflow verifies HTTPS responses from both custom domains, matching their
published JS/CSS bytes against that run's verified artifact and checking the
manifest. Failed verification fails the run; it does not automatically roll back.

## Azure hosting

The approved production target is the existing Azure Static Web App, serving
the frontend at `https://perlygolf.com` and `https://www.perlygolf.com`.
The pipeline uses the repository Actions secret
`AZURE_STATIC_WEB_APPS_API_TOKEN`. Configure it using Azure's supported deployment
token flow; never print the token or put it in tracked configuration.
No new Azure resources, pricing-tier changes, DNS changes or identity services
have been provisioned. API code is not deployed by this frontend pipeline.

The previous source repository is retained, but its deployment workflow must
remain disabled after cutover to prevent it overwriting this app. To roll back,
explicitly approve redeploying a known-good earlier commit through the same
checks; if reverting to the old repository, first stop this deployment pipeline
and coordinate re-enabling the old one. Never leave both writers active.

The approved next design uses near-real-time polling rather than SignalR.
The [operations guide](docs/operations.md) separates reproducible stateless
infrastructure from data restore, retained identity/DNS, secret rotation and
explicit creator bootstrap. IaC generation, cloud resources, permissions,
spending and deployment changes require separate approval.

The [test infrastructure scaffold](infra/README.md) defines a separate Free
frontend, disabled-by-default Flex API, keyless runtime/application storage,
bounded monitoring and narrow runtime permissions using Azure-generated URLs.
That test foundation has been provisioned under separate approval; customer
sign-in/bootstrap remains an explicit gate before enabling the API.
Production SWA/DNS and its deployment workflow are unchanged.

The test deployment workflow runs only on the approved feature branch (or an
authorized manual invocation), behind full CI. It uses a branch-restricted
GitHub environment, a separate test frontend token and secretless OIDC with
Website Contributor on the test API only. It packages compiled API code and
locked production dependencies, not local configuration/credentials, and
uploads prebuilt artifacts without a platform dependency rebuild.
