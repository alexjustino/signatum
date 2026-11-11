import { Button } from '@/ui/Button';

import { nowLine, optionLine, type Toughness, type ToughnessChoice } from './toughness';

/**
 * "Make it tougher" (P10, ADR-038): the changes this screen can make that ask for a larger
 * smudge, toughest first, each with what it gives up and one press to use it.
 *
 * Using a row changes the same control a person would — the logo's size, the level, the link, the
 * printed width — so the gate asks again and the card above measures the new code; nothing here is
 * a second way of making a code. It is a report with shortcuts, never a gate.
 */
export function TougherList({
  toughness,
  onUse,
}: {
  toughness: Toughness;
  onUse: (choice: ToughnessChoice) => void;
}) {
  return (
    <div className="mt-3 flex flex-col gap-2">
      <h3 className="text-caption font-semibold text-fg-secondary">Make it tougher</h3>
      <p className="text-caption text-fg-secondary">{nowLine(toughness.now)}</p>
      {toughness.options.length === 0 ? (
        <p className="text-caption text-fg-tertiary">Nothing on this screen makes it tougher.</p>
      ) : (
        <ul aria-label="Ways to make it tougher" className="flex flex-col gap-2">
          {toughness.options.map((option) => (
            <li
              key={option.key}
              data-key={option.key}
              className="flex items-start justify-between gap-3"
            >
              <div className="flex min-w-0 flex-col">
                <span className="text-body text-fg">{option.label}</span>
                <span className="text-caption text-fg-secondary">{optionLine(option)}</span>
              </div>
              <Button aria-label={`Use: ${option.label}`} onClick={() => onUse(option.choice)}>
                Use
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
