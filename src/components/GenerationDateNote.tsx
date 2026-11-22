import { CalendarClock } from 'lucide-react';

const dateFormatter = new Intl.DateTimeFormat('it-IT', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Rome'
});
const timeFormatter = new Intl.DateTimeFormat('it-IT', {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Rome'
});

/** Formats an ISO timestamp as "sabato 21 novembre 2026 alle 10:32" (Italian time), or null if invalid. */
export function formatGenerationDate(iso?: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${dateFormatter.format(date)} alle ${timeFormatter.format(date)}`;
}

/**
 * Read-only note that shows when a set of sestine was generated.
 * It never triggers a generation: the numbers change only with the generator's own button.
 */
export function GenerationDateNote({
  generatedAt,
  subject = 'Sestine generate',
  regenerateLabel,
  testId = 'generation-date-note'
}: {
  generatedAt?: string | null;
  subject?: string;
  regenerateLabel?: string;
  testId?: string;
}) {
  const formatted = formatGenerationDate(generatedAt);
  return (
    <p
      data-testid={testId}
      className="flex items-start gap-2 rounded-xl border border-sky-800/60 bg-sky-950/40 px-3 py-2 text-xs leading-relaxed text-sky-100"
    >
      <CalendarClock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" />
      <span>
        {formatted ? (
          <>
            {subject} il{' '}
            <time dateTime={generatedAt ?? undefined} className="font-semibold text-white">
              {formatted}
            </time>
            .
          </>
        ) : (
          <>Data di generazione non disponibile: queste sestine risalgono a prima dell’aggiornamento.</>
        )}{' '}
        I numeri restano bloccati finché non scegli tu di rigenerarli
        {regenerateLabel ? <> con «{regenerateLabel}»</> : null}.
      </span>
    </p>
  );
}
