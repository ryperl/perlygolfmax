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
| Dots | New rotating High/Low: Full CH / group SO | Group circuit |
| Nines | Full CH / group SO | Per hole, no carry |

The Stableford rows describe the two formats of one game kind, not additional
game kinds. Linked Dots consumes the explicitly linked Wolf's saved comparisons;
it has no separate handicap selector and never overrides the base game.
Gross modes remain gross. Event-wide Skins and overall net Stroke Play retain
their existing full-handicap calculations. KP remains a distance competition.
Overall Stableford consumes the selected round game's legitimate points.
Competition teams remain separate from playing groups; each member's SO uses
their own saved playing group, even for cross-group Ball Drop teams.

**Nines** is played by one saved playing group of exactly three golfers. Each
hole awards 9 points: 5 for the best score, 3 for second and 1 for the worst.
Tied golfers share the points of the places they occupy, so every hole totals 9:
4/4/1 when two tie for best, 5/2/2 when two tie for worst, 3/3/3 when all three
tie. A pickup, `X7` or DNF ranks below every numeric score; several of them tie
for last. A hole scores only once all three golfers have saved a disposition.
Gross needs no handicap; net uses full captured CH or SO off the group's lowest
captured CH, with personal tees. Missing net inputs are unavailable, never
scratch. An optional stake per point settles once for the group with
`(3 x points - total points) x stake`; blank plays for points only. Nines locks
with the other money games after the first saved score, and stays unavailable
if the saved group no longer holds the same three golfers.

A Dots game may link to the group's Nines game, the same way Dots links to Wolf
version 2. Dots keeps its own specials and unit values; Nines points are the
base. The two settle once, together, at the Nines stake per point:
`(3 x (Nines points + Dots) - total) x stake`. Linked Dots has no stake of its
own. Every golfer is their own side on every hole, so specials follow
individual Dots rules: no Assassin and no automatic High/Low Sweep (manual
Sweep and Category Sweep still work), each special pays only its earner, and a
Walk or Pickup awards both opponents. Only one Dots game may link to a Nines
game; a missing, duplicated or changed link makes the combined settlement
unavailable rather than settling either game alone.

New version-3 Modified Sixes and Sixes may explicitly enable net High/Low
alongside gross specials. Partners change every three or six played holes.
High compares each pair's higher numeric ball; Low compares its lower ball.
Each contest gives one dot to each winning teammate. Ties push with no carry,
deduction or stake multiplier. Version-2 High/Low additionally awards one
automatic **High/Low Sweep** dot to each teammate when the same pair wins both
contests: High 1 + Low 1 + Sweep 1 = 3 each. Split wins, pushes, missing scores
and unavailable lanes never earn this bonus. A pickup loses High to an
all-numeric pair; its partner's numeric Low still competes. Missing numeric
Low is unavailable, never a penalty score. Missing scores/order stay pending.
Base and special dots remain separate sources and settle only once. Existing
version-2 games retain their saved semantics: six-hole rotations remain
specials-only, and High/Low version 1 has no automatic sweep. Explicit unstarted
version-2-to-3 upgrades are supported; started games and order receipts are never
implicitly converted.

## First teams and setup

Setup explains the format and group, first-team method, applicable net rules,
gross special dots and a review summary. Actual player positions are chosen in
score entry on the group's first played hole, not assigned by the setup preview.

- **Tee flip:** first + second versus third + fourth; subsequent blocks use
  1+3/2+4, then 1+4/2+3.
- **Approach ranking:** rank closest through farthest; closest + farthest versus
  the middle two, then 1+3/2+4, then 1+2/3+4.

Both methods preserve their three- or six-played-hole period and actual circuit.
The conditional canonical first-card receipt fixes order and origin through raw
edits, clears, corrections and retries. Missing order leaves results pending
without blocking raw scoring; recovery after saved scoring is server-marked.

**Manual Sweep** remains a separate scorer-declared bonus. **Category Sweep**
remains the automatic same-golfer Long Drive/Blue Plate bonus. Neither replaces
the new automatic High/Low Sweep, and scorers must not enter an automatic bonus
again as a manual one. Individual round-only King bonuses remain separate from
shared hole points and are already included in the displayed special total.

## Dots player description

Dots setup and saved results include a collapsed **How Dots works** description.
It follows the selected specials and distinguishes entered shot facts, calls and
category winners from automatic saved-score awards. Players enter each earned
special once; the app handles current-partner sharing and settlement.

When both Long Drive and Blue Plate are enabled, the same golfer winning both
on the same par-5 hole earns one automatic **Category Sweep** dot for themselves
and each current teammate. Different winners, carried ownership and second
qualifiers do not create or multiply the bonus. Players must not repeat it as
Other or Manual Sweep.

Birdie, Eagle, String, BirdyString, Assassin and King of the Hill are calculated
when selected, using saved gross scores and declared facts. Net High/Low and its
versioned automatic Sweep are explained separately; saved legacy High/Low
without an automatic Sweep is not described as having one. Manual Sweep remains
an explicitly entered, separate agreed bonus. The description changes no rules,
saved scores, permissions or network reads.

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

New Wolf games choose **First Wolf, Second Wolf, Third Wolf and Fourth Wolf**
in score entry on the saved group's first tee, before the declaration, not in
round/game setup. Shotgun starts use the shared saved starting hole.
`orderMode: "first-tee-v1"` stores one immutable order receipt on the canonical
group-first card. Raw scoring remains possible without it; Wolf stays pending.
Other groups do not block order entry. Late recovery is server-marked, and raw
edits, clears and retries preserve the saved order and final-hole comeback
receipts. Unmarked saved Wolf games retain their original setup rotation.

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

Opt-in Modified Sixes High/Low separately negotiates `dotsHighLow=1` and
requires the advertised `dotsHighLowVersion: 1`. Older affected requests must
update before reading or publishing new definitions/results. Full and lean
decoders retain separate transmitted base contests, special totals and combined
standings; lean reconstruction never replaces a transmitted numerical value.

New rotating version-3 games require the composite `dotsRules=3` and
`dotsHighLow=2` negotiation, advertised Dots rules version 3 and High/Low
capability 2. This binds both first-team methods and automatic High/Low Sweep
calculations. Unaffected legacy projections retain their supported capability
versions; affected old reads, writes and staged publications fail with 426
before mutation. Original saved rules, scores, captures and audits are retained.

Nines negotiates `nines=1` or `nines=2` on every request that also sends
`dotsRules=3`. The API advertises the `nines` game kind only to those clients.
Older clients reading or writing a round that contains Nines receive 426 before
any change; rounds without Nines read exactly as before. `nines=2` adds Dots
linked to Nines, advertised as `ninesLinkedDots: true` on round scores. A
`nines=1` client still reads plain Nines but receives 426 for any round with
Dots linked to Nines.

First-tee Wolf order separately negotiates `wolfOrders=1`, with advertised
`wolfOrderVersion: 1`. Affected old reads and score, game, correction and purse
publications fail before mutation. No general setup permission is added.

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
