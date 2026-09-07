import type { ReactNode } from "react";

export type SlotVariant = "default" | "pending" | "muted" | "dark";

/**
 * A slot block: one bounded piece of time. This is the repeated element the
 * whole product is built from — an availability window on the landing page, a
 * booked session on the dashboard, an offering on a profile.
 */
export function SlotBlock({
  time,
  duration,
  title,
  meta,
  variant = "default",
  badge,
  trailing,
}: {
  time: string;
  duration: string;
  title: string;
  meta?: string;
  variant?: SlotVariant;
  /** Sits under the meta line — the right choice in a narrow column. */
  badge?: ReactNode;
  /** Sits beside the body — only where the block has room to spare. */
  trailing?: ReactNode;
}) {
  const modifier = variant === "default" ? "" : ` ui-slot--${variant}`;
  return (
    <div className={`ui-slot${modifier}`}>
      <div className="ui-slot__edge">
        <span className="ui-slot__time">{time}</span>
        <span className="ui-slot__dur">{duration}</span>
      </div>
      <div className="ui-slot__body">
        <span className="ui-slot__title">{title}</span>
        {meta ? <span className="ui-slot__meta">{meta}</span> : null}
        {badge ? <div className="ui-slot__badge">{badge}</div> : null}
      </div>
      {trailing ? <div className="ui-slot__trailing">{trailing}</div> : null}
    </div>
  );
}
