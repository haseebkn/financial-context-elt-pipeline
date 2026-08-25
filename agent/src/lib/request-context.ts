/**
 * Per-turn context that must not live in the cacheable system-prompt prefix.
 * Keeping the date in a trailing block preserves prompt-cache reuse while
 * giving relative phrases such as "last month" one authoritative anchor.
 */
export function buildRequestContext(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const currentDate = `${value("year")}-${value("month")}-${value("day")}`;

  return [
    "## Current request context",
    `Current date: ${currentDate}.`,
    `User time zone: ${timeZone}.`,
    "Interpret relative dates such as today, last month, and next week from this date — never from the newest warehouse row.",
  ].join("\n");
}
