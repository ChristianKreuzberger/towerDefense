# 12 Playtest Script and Feedback Form

Phase 3 exit criterion (issue #106): a first-time player can explain what to do and why without help, and the game is fun. This document is the script and the forms. Running the session and recording findings needs real people, so the results sections below start empty.

## Roles

- Facilitator: runs the script, keeps time, answers only "how do I..." questions after the player has tried, never explains the rules during the first 5 minutes.
- Players: 3 to 4 humans, at least one who has never seen the game (the first-timer). One more experienced player is useful for the difficulty question.
- Observer: silent, notes every confusion moment with a timestamp (see the observer log). Can be the facilitator in a small group, but then recording is slower.

## Setup (before people arrive, 5 minutes)

1. Branch built and running: `npm run build`, then `npm run dev:game`. Open the game in a fresh browser profile (or clear site data) so the how-to-play tour appears for the first-timer.
2. One shared screen or laptop for hot-seat play. Optional: a phone for the touch layout.
3. Menu: 3 or 4 human seats plus bots to make 4 players (for example 3 humans and 1 bot), medium difficulty bot, a fixed seed (write it down so a run can be repeated), sound on, music off.
4. Print or open the feedback form and the observer log.
5. Note the build: commit hash and date.

## Script (20 minutes)

| Time | Step | Facilitator does |
| --- | --- | --- |
| 0:00 to 0:05 | Start with no explanation | Say only: "Play this. Talk out loud about what you think is happening." Do not explain the goal, the tower types or the damage types. The how-to-play tour may be read or skipped by the players. Observer logs every hesitation. |
| 0:05 to 0:15 | Play waves 1 to 6 | Let the group play. Do not interrupt. Make sure the group passes through the first splitter (wave 4 or later) and the first boss (wave 5). If time runs short, use the same seed and skip ahead only by readying up faster. Note the wave reached at 0:15. |
| 0:15 to 0:20 | Debrief and forms | Stop at 0:15 even mid-wave. Ask the first-timer: "Explain to me what you are supposed to do, and why." Write the answer down word for word. Then everyone fills in the feedback form on their own, then a 2 minute group discussion. |

## What to observe

- Where the first-timer looks first, and how long until the first tower is placed.
- Do they understand the tower type picker (arrow, cannon, frost) and choose on purpose?
- Do they notice the next-wave line with weak and resists hints, and use it to pick a damage type?
- Do they know whose turn it is in hot-seat play, and which tower is theirs?
- Reaction to the first splitter (splitting) and to the boss: surprise, fun, or confusion?
- Do they notice tower health and repairs, and understand why a tower was lost?
- Are effects and sounds helpful or noisy? Anything missed that they wanted to see or hear?
- Phone or touch players: missed taps, hard to read text.

## Observer log

| Time | Player | What happened | Confusion, delight, or bug? |
| --- | --- | --- | --- |
|  |  |  |  |

## Feedback form (one per player)

Name or number (optional): ______  Device and browser: ______  Played before? yes / no

Rate 1 (worst) to 5 (best):

1. Clarity: I understood what was happening on screen. 1 2 3 4 5
2. Fun: I enjoyed the game. 1 2 3 4 5
3. Difficulty: 1 = far too easy, 3 = about right, 5 = far too hard. 1 2 3 4 5

Yes or no:

4. I could explain what to do and why without help. yes / no
5. I knew whose turn it was and which tower was mine. yes / no
6. I understood the hints about what each creature is weak to or resists. yes / no
7. I would play another match. yes / no

Free text:

8. The most confusing moment: ______
9. The best moment: ______
10. Which towers did you pick and why? ______
11. Something you wanted to do but could not: ______
12. Anything too loud, too busy, or too quiet (effects or sound)? ______

## Session record

- Date: ______  Build (commit): ______  Seed: ______  Players (humans and bots): ______
- Wave reached at 0:15: ______  Facilitator: ______  Observer: ______
- First-timer's own explanation of the game (verbatim): ______

## Findings template

Copy one block per finding, then file a follow-up issue for every finding with severity 2 or higher. Link the issue in the last row.

- Title: ______ (short, plain words)
- Severity: 1 = polish, 2 = annoying, 3 = blocks understanding or fun
- Step where it happened: ______ (script step and wave)
- What the player did and said: ______
- Proposed follow-up: ______
- Issue: ______

## Findings (empty until a session is run)

None recorded yet. The Phase 3 exit criterion is met when the feedback confirms clarity and fun (questions 1, 2 and 4 mostly 4 or 5 and "yes"), or every gap is filed as an issue.
