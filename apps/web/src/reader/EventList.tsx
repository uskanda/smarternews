import type { ArticleSummary } from "@smarternews/core/api";
import { Link } from "react-router";
import { eventTime, groupEvents, registrationLabel } from "@smarternews/client";

/** Upcoming events of one category, grouped by the day they start. */
export function EventList({
  title,
  events,
  selectedId,
  to,
  timeZone,
  now,
}: {
  title: string;
  events: ArticleSummary[];
  selectedId: number | null;
  to: (id: number) => string;
  timeZone: string;
  now: Date;
}) {
  const groups = groupEvents(events, timeZone, now);
  return (
    <section aria-label="イベントの一覧" className="flex h-full min-h-0 flex-col bg-surface">
      <header className="border-b border-outline px-lg py-md">
        <h1 className="type-headline-md">{title}</h1>
      </header>
      <div data-list-scroll className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <p className="p-lg type-body-md text-on-surface-muted">これから開催されるイベントはありません。</p>
        ) : null}
        {groups.map((group) => (
          <div key={group.label} role="group" aria-label={group.label} className="border-b border-outline">
            <h2 className="bg-background px-lg py-xs type-label-md">
              {group.date}
              {group.weekday ? <span className="pl-sm type-label-sm text-on-surface-muted">{group.weekday}</span> : null}
            </h2>
            <ul>
              {group.events.map((item) => {
                const event = item.event!;
                const registration = registrationLabel(event.registration);
                const selected = item.id === selectedId;
                return (
                  <li key={item.id} data-read={item.isRead} className={`border-t border-outline ${selected ? "bg-selected" : ""}`}>
                    <Link to={to(item.id)} aria-current={selected ? "true" : undefined} className="flex flex-col gap-px px-lg py-md">
                      <span data-title className={item.isRead ? "type-body-md text-on-surface-muted" : "type-label-md"}>
                        {item.title}
                      </span>
                      <span className="flex flex-wrap gap-x-md gap-y-xs type-label-sm text-on-surface-muted">
                        <span className="tabular-nums">{eventTime(event, timeZone)}</span>
                        {event.venue ? <span>{event.venue}</span> : null}
                        {event.fee ? <span>{event.fee}</span> : null}
                        {registration ? <span>{registration}</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
