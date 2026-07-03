# Replay CSV Key

`GET /api/replay.csv?code=<ROOM>` exports the full history of an ended game. Event and post-action hand rows describe **state after** the event they belong to. Game actions also carry explicit pre-action context through `pre_*` board columns and `pre_hand_card` rows so recap tools do not need to reverse-engineer decision-time state from the previous event.

## Row types (`row_type`)

| Value | Meaning | Cardinality |
|---|---|---|
| `game` | One summary row for the whole game. | 1 |
| `event` | One row per timeline event: `start`, each move (`give-clue`, `play`, `discard`), each `layout` checkpoint, and `end-game`. | per event |
| `pre_hand_card` | One row per card in each player's hand immediately before an action event, including what its owner knew at decision time. | per action event × per card |
| `hand_card` | One row per card in each player's hand at each event — the per-card snapshot behind that event, including what its owner knew about it. | per event × per card |
| `layout_checkpoint` | One row per card in the rearranging player's hand at a `layout` event, carrying that card's table position. | per layout event × per card |

`pre_hand_card`, `hand_card`, and `layout_checkpoint` rows repeat their parent event's columns, so the file can be filtered flat without joins. For `pre_hand_card` rows, the regular board-state columns (`deck_count`, `hints`, `turn_seat`, and related fields) describe the pre-action snapshot for that row.

## Move numbering (`move_number`)

`start` = 0; game moves count 1..n in order; `end-game` carries the final move's number; `layout` events carry the number of the move they followed (0 if before the first move). Matches the "Move N" label in the replay UI.

## Columns

### Identity & bookkeeping
| Column | Meaning |
|---|---|
| `row_type` | See table above. |
| `event_seq` | Server-assigned monotonic sequence number; rows are ordered by it. |
| `event_type` | `start`, `give-clue`, `play`, `discard`, `layout`, `end-game`. |
| `event_at` | Event timestamp, Unix epoch milliseconds. |
| `code` | Room code. |
| `created_at` / `ended_at` | Room creation / game end, epoch milliseconds. |
| `move_number` | See above. |

### The move
| Column | Meaning |
|---|---|
| `actor_seat` | Seat that acted (`A`/`B`). For `layout` events, the seat that rearranged. |
| `target_seat` | Clue recipient (clue events only). |
| `action_card_id` / `action_card_color` / `action_card_rank` | The card played or discarded. |
| `clue_kind` / `clue_value` / `clue_label` | Clue given: `rank` or `color`, its value, and the display label. |
| `clued_card_ids` | Pipe-separated ids of the cards the clue touched. |
| `result_pile` | Where the card landed: `firework` (successful play) or `discard` (discard, or failed play). |
| `result_action` | What the player attempted: `play` or `discard`. `result_action=play` + `result_pile=discard` = misplay. |
| `play_succeeded` | `true`/`false` on play events. |
| `drew_replacement` / `replacement_card_id` | Whether a replacement card was drawn, and which card id was drawn. Join to the post-action `hand_card` row for that card's identity, layout, and `is_newest_card=true`. |

### Per-card snapshot (`pre_hand_card` / `hand_card` / `layout_checkpoint` rows)
| Column | Meaning |
|---|---|
| `hand_seat` / `hand_index` | Whose hand and position within it. |
| `is_newest_card` | `true` for the newest/rightmost card in that hand snapshot. Useful for finding the card just picked up in post-action `hand_card` rows, or the decision-time newest card in `pre_hand_card` rows. |
| `card_id` / `card_color` / `card_rank` | The card's true identity. |
| `possible_colors` / `possible_ranks` | What the card's owner could deduce from clues, pipe-separated. |
| `possible_identities` | Owner-deducible `color-rank` combinations, pipe-separated. |
| `layout_x` / `layout_y` | Card position on the hand surface, percent coordinates. |
| `layout_rotation` | Card rotation, degrees. |

### Board state before action (`pre_*`)
| Column | Meaning |
|---|---|
| `pre_deck_count` | Cards left in the deck before the action. |
| `pre_turn_seat` | Whose turn it was before the action. |
| `pre_status` | Game status before the action. |
| `pre_final_turns_remaining` | Final-round countdown before the action; empty before the deck is exhausted. |
| `pre_score` | Score before the action. |
| `pre_hints` / `pre_bombs` | Hint and bomb counts before the action. |
| `pre_fireworks` | Stack heights before the action. |
| `pre_discard_ids` | Pipe-separated discard ids before the action. |
| `pre_end_reason` | End reason before the action, normally empty. |

### Board state (post-event)
| Column | Meaning |
|---|---|
| `deck_count` | Cards left in the deck. |
| `turn_seat` | Whose turn is next. |
| `status` | `playing` or `ended`. |
| `final_turns_remaining` | Countdown once the last card is drawn; empty before. |
| `score` | Score after this event. |
| `hints` / `bombs` | Hint and bomb counts after this event. |
| `fireworks` | Stack heights, e.g. `red:3\|yellow:0\|…`. |
| `discard_ids` | Pipe-separated ids in the discard, chronological. |
| `end_reason` | `deck`, `strikes`, or `perfect` once ended. |

### Game settings & totals (repeated on every row)
| Column | Meaning |
|---|---|
| `settings_max_hints` / `settings_max_bombs` | Room settings. |
| `include_rainbow` | Whether the rainbow suit is in play. |
| `colors` | Suit ids in play, pipe-separated. |
| `max_score` | Suits × 5. |
| `final_score` | The game's final score (constant across rows). |
