# Shader 0.45 Plan

## Goal

Enhance the playhead lighting for `patternv0.45.wgsl` so the active row is more visually anticipated and followed, while keeping the playing note color lit for the duration of the sound.

Specifically:
- Activate playhead indicators on the next two rows before the current row.
- Keep the current row strongly lit.
- Dim the indicators over the two rows immediately after the current row.
- Retain the note color for a note that is still sounding after its trigger row, instead of fading it out immediately.

This will make playback feel more responsive, preserve note sustain information, and improve the user's ability to follow the sequence.

## Design

### Playhead behavior

1. **Pre-row indicators**
   - Rows `currentRow + 1` and `currentRow + 2` should display a subtle anticipatory glow.
   - These pre-row indicators should be visually distinct from a full note hit, using reduced intensity or a cooler tint.

2. **Current row highlight**
   - The current row remains the brightest row in the playfield.
   - Use a stronger halo or bloom effect around the current row's cells.

3. **Post-row dimming**
   - Rows `currentRow - 1` and `currentRow - 2` should retain a softer, fading glow for two rows after the playhead passes.
   - This trailing glow should be weaker than the pre-row indicator and should decay quickly.

### Note sustain behavior

1. **Keep note color lit while playing**
   - If the cell's note is still sounding after its trigger row, preserve the note's color and glow state for the remaining duration.
   - Do not collapse sustained notes into a generic background once the playhead moves on.

2. **Differentiating sustained notes**
   - Use a slightly lower intensity or a narrower glow for sustained note continuation than for an active trigger row.
   - If a note is still playing, its cell should continue to read as "active note" rather than "inactive row." This prevents the recharge effect from erasing audible sustain.

3. **Expression-only rows**
   - If a row contains only volume/panning/effect changes with no new note trigger, render it with a distinct accent (for example, amber or softer glow) rather than full note color.
   - This helps separate true sustained note activity from expression changes that happen mid-note.

## Implementation approach for `shaderv0.45`

### Data inputs

- Verify that the shader receives a `playheadRow` uniform or per-frame uniform.
- If not already present, add a small `playheadOffset` / `fractionalPlayhead` uniform to support row-relative calculations.

### Shader logic

- Compute a row-distance metric for each visible row relative to `playheadRow`.
- For rows ahead by 1 and 2:
  - Add a pre-playhead glow with a lower emission strength and cooler tint.
- For the current row:
  - Use the strong current-row highlight logic already present in `patternv0.45.wgsl`, but increase contrast and bloom if needed.
- For rows behind by 1 and 2:
  - Apply a dimming tail using the same distance metric, fading quickly over the two-row window.

### Note sustain handling

- Add a `noteIsSustained` or `noteDurationRemaining` flag/data field to the pattern cell data if not already available.
- If `noteIsSustained == true`:
  - Keep the active note color active for that cell beyond the trigger row.
  - Use a lower-intensity continuation rendering style, while preserving the note's hue.
- If the row has note continuation but no trigger:
  - Render it as a continuation state rather than a full hit.

## Planned `shader_0.50` follow-up

In the next iteration, `shader_0.50` should add explicit note duration logic:

- Compute exact note length in rows from the pattern/note data stream.
- Pack the duration into the pattern data buffer passed into the shader.
- In the shader:
  - Render a sustained-note "tail" across the note's full duration.
  - Keep the note color lit for every row that belongs to that note.
  - Separate out a distinct expression-only visual state for rows that are not new note triggers but still occur while the note is sounding.

### `shader_0.50` behavior goals

- `noteDuration > 0` should create a visible continuation trail.
- `currentRow` remains the strongest highlight.
- Future rows within the same note should remain tinted with the active note color, but with a softer sustained glow.
- Past rows that belonged to a note should dim only after the note actually stops.
- Expression-only rows in a sustained note should not look identical to new note triggers.

## Implementation checklist

- [ ] Add pre-playhead and post-playhead row weighting in `patternv0.45.wgsl`.
- [ ] Ensure row distance is computed consistently for pattern wraparound and visible window.
- [ ] Preserve note color on sustained rows using a `noteSustain` flag or duration field.
- [ ] Render expression-only rows with a separate visual state.
- [ ] Validate against actual playback with long notes and fast patterns.
- [ ] Create follow-up plan for `shader_0.50` that upgrades from flags to concrete duration values.

## Notes

- This is intentionally a shader-first visual improvement with minimal data-model change for `0.45`.
- `0.50` is the opportunity to make the note sustain logic exact and correct at the data level.
- Keep the playhead and sustain logic separate: the playhead should always be visible, while sustain should only persist if the note is actually still sounding.
