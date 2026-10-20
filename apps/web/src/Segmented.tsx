type Option<T extends string | boolean> = { value: T; label: string };

export function segmentedSize<T extends string | boolean>(options: readonly Option<T>[]): string {
  let longest = 0;
  for (const option of options) {
    let width = 0;
    for (const char of option.label) width += char.charCodeAt(0) < 128 ? 0.55 : 1;
    longest = Math.max(longest, width);
  }
  if (options.length >= 4 || (options.length >= 3 && longest > 5) || longest > 8) return 'segmented--small';
  if (options.length >= 3 || longest > 6) return 'segmented--medium';
  if (longest > 4) return 'segmented--large';
  return '';
}

export default function Segmented<T extends string | boolean>({ label, options, value, onChange }: {
  label?: string; options: readonly Option<T>[]; value: T; onChange: (value: T) => void;
}) {
  const size = segmentedSize(options);
  return <div className={`segmented${size ? ` ${size}` : ''}`} role="group" aria-label={label}>
    {options.map((option) => <button type="button" key={String(option.value)}
      className={value === option.value ? 'selected' : ''} aria-pressed={value === option.value}
      onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}
