/**
 * The look-alike guard's sentences, inside the caution InfoBar that carries them (ADR-034).
 *
 * One sentence is a line of text; more than one is a list, so each is its own line and a screen
 * reader says how many there are before it reads them. Not a primitive: it is the body of an
 * `InfoBar`, written once so that Create and Read say the same thing the same way.
 */
export function AddressSentences({ sentences }: { sentences: readonly string[] }) {
  if (sentences.length === 1) return <p>{sentences[0]}</p>;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5">
      {/* Two labels of one host can earn the same sentence; the position keeps the keys apart. */}
      {sentences.map((sentence, at) => (
        <li key={`${at}:${sentence}`}>{sentence}</li>
      ))}
    </ul>
  );
}
