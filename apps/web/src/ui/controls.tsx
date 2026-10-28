import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from "react";
import { useId } from "react";
import { fieldError, messageFor as sharedMessageFor } from "@smarternews/client";

type Variant = "primary" | "secondary" | "danger" | "quiet";

const BUTTON: Record<Variant, string> = {
  primary: "border-primary bg-primary text-on-primary",
  secondary: "border-outline-strong bg-surface text-on-surface hover:border-primary aria-pressed:border-primary aria-pressed:bg-selected",
  danger: "border-error bg-error text-on-error",
  quiet: "border-transparent text-primary underline underline-offset-4",
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; ref?: Ref<HTMLButtonElement> }) {
  return (
    <button
      type={type}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center gap-xs rounded-md border px-md py-xs type-body-md disabled:cursor-not-allowed disabled:opacity-50 ${BUTTON[variant]} ${className}`}
      {...props}
    />
  );
}

export function Badge({ tone = "muted", children }: { tone?: "muted" | "warning" | "error"; children: ReactNode }) {
  const color = tone === "warning" ? "text-warning" : tone === "error" ? "text-error" : "text-on-surface-muted";
  return <span className={`rounded-sm border border-current px-xs type-label-sm ${color}`}>{children}</span>;
}

/** The star of a starred article: `star-mark` in DESIGN.md, an icon read out as "スター". */
export function StarMark() {
  return (
    <svg role="img" aria-label="スター" viewBox="0 0 24 24" className="star-mark">
      <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />
    </svg>
  );
}

const INPUT =
  "w-full rounded-md border border-outline-strong bg-surface px-sm py-xs type-body-md text-on-surface aria-invalid:border-error";

/** A labelled input with room for a hint and for the reason a value was refused. */
export function Field({
  label,
  hint,
  error,
  multiline,
  ...props
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  multiline?: boolean;
} & InputHTMLAttributes<HTMLInputElement> &
  TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const shared = { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined, className: INPUT };
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor={id} className="type-label-md">
        {label}
      </label>
      {multiline ? <textarea rows={4} {...shared} {...props} /> : <input {...shared} {...props} />}
      {hint ? (
        <p id={`${id}-hint`} className="type-label-sm text-on-surface-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="type-label-sm text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-xs type-body-md">
      <input type="checkbox" className="accent-primary" {...props} />
      {label}
    </label>
  );
}

/** What went wrong, in the app's words. */
export function messageFor(error: unknown): string {
  return sharedMessageFor(error, "表示できませんでした。ページを読み込み直してください。");
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-lg flex flex-wrap items-center gap-md rounded-md border border-error px-lg py-sm type-body-md text-error">
      <span>{messageFor(error)}</span>
      {onRetry ? (
        <Button onClick={onRetry} className="text-on-surface">
          再試行
        </Button>
      ) : null}
    </div>
  );
}

export function Loading() {
  return <p className="p-lg type-body-md text-on-surface-muted">読み込み中…</p>;
}

export function PageHeading({ children }: { children: ReactNode }) {
  return <h1 className="type-headline-md">{children}</h1>;
}

export { fieldError };
