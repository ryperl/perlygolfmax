# Game starts and net handicap rules

All nine round game kinds use saved round inputs. Starting holes belong to
playing groups, not independent games. The Games editor shows these saved starts;
changes go through the existing authorized full or public Quick-round setup.
Ordinary public internal-game editing does not grant general setup permission.
Saved scoring locks starts and explicit handicap/circuit rules.

## Supported games

| Game | Explicit net choice | Starting-hole behavior |
| --- | --- | --- |
| Individual Stableford | Allowance / group SO | Group navigation |
| Team Stableford | Allowance / group SO | Group navigation |
| Ball Drop | Full CH / group SO, net balls | Group navigation |
| Round Skins | Full CH / group SO | One-foursome carry circuit |
| Round Stroke Play | Full CH / group SO | Group navigation |
| Churchie | Full CH / group SO, High/Low | Version-3 circuit |
| Wolf | Full CH / group SO, net balls | Group circuit |
| Nassau | Full CH / group SO, net balls | Explicit circuit |
| Match Play | Full CH / group SO, net balls | Group circuit |
| Dots | No standalone net contest | Group circuit |

The Stableford rows describe the two formats of one game kind, not additional
game kinds. Linked Dots consumes the explicitly linked Wolf's saved comparisons;
it has no separate handicap selector and never overrides the base game.
Gross modes remain gross. Event-wide Skins and overall net Stroke Play retain
their existing full-handicap calculations. KP remains a distance competition.
Overall Stableford consumes the selected round game's legitimate points.
Competition teams remain separate from playing groups; each member's SO uses
their own saved playing group, even for cross-group Ball Drop teams.

## Course Handicap and SO

`handicapRule: "full-course-v1"` uses full captured Course Handicap (CH) in stroke
and match games. Stableford retains its configured allowance and existing exact
unrounded-CH allowance calculation. New UI definitions default to this choice.

`handicapRule: "group-low-v1"` uses the full calculated CH first, then subtracts
the lowest CH across the **entire saved playing group**, not a selected match
pair or competition team. Stableford's allowance does not apply to this choice.
For fictional CH values `[11, 4, 8, 3]`, SO is `[8, 1, 5, 0]`.

CH is calculated once for the captured 9- or 18-hole layout and each golfer's
personal/default tee. SO is allocated using that same personal tee. Nine-hole CH
is not halved again. Plus and zero handicaps remain distinct; missing CH makes
the affected group-low input unavailable, never zero. Full mode does not require
another golfer's CH. Corrected input revisions recompute derived results while
preserving original captures, raw cards, score locks and audit receipts.

All Dots and Churchie specials remain **personal gross**: String, BirdyString,
Birdie, Eagle, Sandy, Hogan, Seve, Pully and called Paree/Murphy/Pully Murphy.
A raw 5 on personal par 4 is not a String qualifier even if SO supplies a stroke
and the base High/Low comparison uses net 4. Distance and category qualifications
also remain unchanged. Score entry shows CH and applicable whole-group SO,
not a hole's received-stroke count.

Scorecard stroke dots follow the selected game's effective SO when applicable,
including an explicitly linked Wolf context. Full/gross and strokes-only views
retain CH dots. The full saved group supplies the minimum even in an individual
card. Personal tee allocation, gross score marks and counting-ball roles remain
unchanged; unavailable SO never becomes scratch.

Pully Murphy's explicit called checkbox opts into a score-derived **exact
personal gross par** target. It does not infer a call or a long putt from strokes.
Birdie is not a made Pully Murphy; ordinary Pully still permits par or birdie.
Unplayed remains pending, pickup/DNF misses. Legacy manual calls remain manual
until explicit opt-in, preserving their identities and existing multipliers.

Compatible owner input corrections apply without deleting retained special
claims. A claim that no longer qualifies is withheld and flagged for review;
unrelated known specials and Churchie High/Low remain available. Related totals
remain provisional, not final settlement. Invalid manual success is not
silently changed into an opponent-awarding failure. Correction award audits
include standalone Churchie version 3 and never rewrite original receipts.

## Starting holes and carries

Group circuits wrap through the captured layout from the saved starting hole.
Changing the start affects the group's navigation and all circuit-based games.
It is a conditional round-setup write, not an independent game-settings write.
Quick-round starting-hole choices are visible for each group without opening
its roster editor. Organizer round setup retains the same shared choice.

New or explicitly changed Skins carryovers require the **entire round** to be
one saved group containing exactly four golfers. The configuration uses
`carryOrder: "shared-group-v1"` and awards carries in that foursome's actual
circuit. There are no separate per-group Skins contests. Noncarry Skins remains
round-wide. Multi-group rounds are ineligible for new carries even if all their
groups start on the same hole. Final unclaimed carries remain unawarded.

New Nassau uses `playOrder: "shared-group-v1"`. Front still consists of printed
holes 1–9 and Back of 10–18; each segment is traversed in actual played order.
Overall follows the entire shared circuit. Automatic and manual presses remain
independent bets within their parent segment, and new proofs bind the selected
rules and whole-group CH where required.

Singles setup uses Golfer/Opponent, then the selected names throughout entry
and results. Team matches show their members and custom team names. Saved
strokes calculate the normal outcome automatically; optional concede/halve
actions do not replace raw strokes and save through the existing hole write.

## Protocol and legacy compatibility

The API advertises `gameHandicapRules: 1` in round scores. Current score, game,
purse and tester transports negotiate `gameHandicaps=1`, including digest pages,
staged publications and lean acknowledgements. Unknown or duplicate versions
require an update. Full and lean decoders validate markers, captured group-low
values and transmitted results without substituting different totals.

Updated clients additionally negotiate `gameCalculations=2`; the API advertises
`gameCalculationsVersion: 2` and narrow `pullyMurphyTargets` support. This covers
signed full-plus Wolf allocation, circuit Nassau presses, isolated special
review and score-derived Pully Murphy. Compatible unaffected old reads remain
available; affected old reads and business writes require an update before
mutation. New full-net Wolf writes require version-2 support even before
captured inputs could become plus. Full/lean numerical authority is preserved.

Unmarked saved definitions retain their original rules: Stableford allowance,
full-CH stroke games, off-low Churchie/Wolf, and match-participant-low
Nassau/Match Play. Unmarked Nassau and Churchie versions 1/2 retain printed-order
rules and original proofs. Churchie version 2 has its existing explicit
unstarted upgrade to version 3; version 1 is not silently migrated.

Unmarked saved multi-group Skins carries remain readable and unchanged.
An unchanged old echo or raw score save does not migrate them. A new or edited
carry configuration must explicitly adopt the one-foursome rule before
publication. Affected unsupported reads/writes fail with HTTP 426 before a
business mutation; immutable inactive upload parts may be retained for retry,
but cannot publish an unsupported configuration. Existing permission, quota,
revision, idempotency, correction and audit checks remain authoritative.
