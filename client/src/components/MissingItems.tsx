// Every item still needed before a contract's analysis is done, each on its own
// line — never truncated to "first item +N".
export default function MissingItems({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="missing-list" aria-label="Still needed">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
