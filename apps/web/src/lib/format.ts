const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** "28 Sept 2026, 14:05" in the browser's time zone; "—" for empty. */
export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTime.format(new Date(iso)) : '—';
}

const dateOnly = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "Wed, 09 Sept 2026" for a calendar date "2026-09-09" (no time-zone shift). */
export function formatDate(iso: string | null | undefined): string {
  return iso ? dateOnly.format(new Date(`${iso}T00:00:00Z`)) : '—';
}

/** Random temporary password that satisfies the policy (letters + digits, 12 chars). */
export function generateTemporaryPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ'; // no look-alikes (l, I, O)
  const digits = '23456789';
  const all = letters + digits;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0]! % set.length]!;
  const chars = [pick(letters), pick(digits), ...Array.from({ length: 10 }, () => pick(all))];
  // Shuffle so the guaranteed letter/digit are not always first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

/** Amount text with thousands separators; the value itself is exact text from the API. */
export function amountText(value: string): string {
  const [int = '0', dec] = value.replace('-', '').split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${value.startsWith('-') ? '-' : ''}${grouped}${dec !== undefined ? `.${dec}` : ''}`;
}

/** Signed amount for statements: debits as is, credits in brackets ("(1,234.00)"). */
export function bracketAmount(value: string): string {
  return value.startsWith('-') ? `(${amountText(value.slice(1))})` : amountText(value);
}

/** "Dr 400,000.00" / "Cr 1,250.00" */
export function drCr(amount: string): string {
  return amount.startsWith('-') ? `Cr ${amountText(amount.slice(1))}` : `Dr ${amountText(amount)}`;
}
