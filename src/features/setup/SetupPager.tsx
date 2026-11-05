export function SetupPager({ page, count, size, label, onChange }: {
  readonly page: number;
  readonly count: number;
  readonly size: number;
  readonly label: string;
  readonly onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / size));
  if (pages <= 1) return null;
  return <nav className="setup-pagination" aria-label={`${label} pages`}>
    <button type="button" disabled={page === 0} onClick={() => { onChange(page - 1); }}>Previous {label}</button>
    <span>Page {page + 1} of {pages} · {count} {label}</span>
    <button type="button" disabled={page >= pages - 1} onClick={() => { onChange(page + 1); }}>Next {label}</button>
  </nav>;
}
