import { useId } from 'react';

import { Button } from '@/ui/Button';

import { nowLine, optionLine, type Toughness, type ToughnessChoice } from './toughness';

/** The section's heading and its list's accessible name, in the same words (DESIGN_SYSTEM §8). */
const TITLE = 'Ways to make it tougher';

/**
 * "Make it tougher" (P10, ADR-038): the changes this screen can make that ask for a larger
 * smudge, toughest first, each with what it gives up and one press to use it.
 *
 * Using a row changes the same control a person would — the logo's size, the level, the link, the
 * printed width — so the gate asks again and the card above measures the new code; nothing here is
 * a second way of making a code. It is a report with shortcuts, never a gate.
 *
 * Every row's button reads "Use" and is named for its row — "Use: A small logo" — so the visible
 * word starts the name and a list of buttons is still a list of different things. The row's line,
 * what the code becomes and what the change gives up, is the button's description, so a person who
 * moves from button to button hears the cost before pressing, not only the change.
 */
export function TougherList({
  toughness,
  onUse,
}: {
  toughness: Toughness;
  onUse: (choice: ToughnessChoice) => void;
}) {
  const id = useId();
  return (
    <div className="mt-3 flex flex-col gap-2">
      <h3 className="text-caption font-semibold text-fg-secondary">{TITLE}</h3>
      <p className="text-caption text-fg-secondary">{nowLine(toughness.now)}</p>
      {toughness.options.length === 0 ? (
        <p className="text-caption text-fg-tertiary">Nothing on this screen makes it tougher.</p>
      ) : (
        <ul aria-label={TITLE} className="flex flex-col gap-2">
          {toughness.options.map((option) => {
            const line = `${id}-${option.key}`;
            return (
              <li
                key={option.key}
                data-key={option.key}
                className="flex items-start justify-between gap-3"
              >
                <div className="flex min-w-0 flex-col">
                  <span className="text-body text-fg">{option.label}</span>
                  <span id={line} className="text-caption text-fg-secondary">
                    {optionLine(option, toughness.now)}
                  </span>
                </div>
                <Button
                  aria-label={`Use: ${option.label}`}
                  aria-describedby={line}
                  onClick={() => onUse(option.choice)}
                >
                  Use
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
