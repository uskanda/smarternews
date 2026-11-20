import type { ArticleSummary } from "@smarternews/core/api";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { eventTime, groupEvents, registrationLabel } from "@smarternews/client";
import { Button, ErrorNotice, Loading } from "../ui/controls.tsx";
import { SelectedMark } from "./SelectedMark.tsx";

/** Where the fetch of the events stands, and what loads the rest; the list of articles shows the same. */
export type EventListState = {
  pending: boolean;
  error: unknown;
  retry: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
};

/** Upcoming events of one category, grouped by the day they start. */
export function EventList({
  title,
  actions,
  state,
  events,
  selectedId,
  to,
  timeZone,
  now,
}: {
  title: string;
  /** The buttons beside the title, as the list of articles has them. */
  actions: ReactNode;
  state: EventListState;
  events: ArticleSummary[];
  selectedId: number | null;
  to: (id: number) => string;
  timeZone: string;
  now: Date;
}) {
  const groups = groupEvents(events, timeZone, now);
  const failed = state.error !== null && state.error !== undefined;
  return (
    <section aria-label="イベントの一覧" className="flex h-full min-h-0 flex-col bg-surface">
      <header className="flex items-center justify-between gap-sm border-b border-outline px-lg py-md">
        <h1 className="min-w-0 truncate type-headline-md" title={title}>
          {title}
        </h1>
        <div className="flex shrink-0 gap-sm">{actions}</div>
      </header>
      <div data-list-scroll className="min-h-0 flex-1 overflow-y-auto">
        {failed ? <ErrorNotice error={state.error} onRetry={state.retry} /> : null}
        {state.pending && !failed ? <Loading /> : null}
        {!state.pending && !failed && groups.length === 0 ? (
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
                  <li key={item.id} data-read={item.isRead} className={`relative border-t border-outline ${selected ? "bg-selected" : ""}`}>
                    {selected ? <SelectedMark /> : null}
                    <Link to={to(item.id)} aria-current={selected ? "true" : undefined} className="flex flex-col gap-px px-lg py-md">
                      <span className={item.isRead ? "type-body-md text-on-surface-muted" : "type-label-md"}>
                        {item.isRead ? null : <span className="sr-only">未読。</span>}
                        <span data-title>{item.title}</span>
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
        {state.hasMore ? (
          <div className="flex justify-center p-lg">
            <Button onClick={state.loadMore} disabled={state.loadingMore}>
              さらに読み込む
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
