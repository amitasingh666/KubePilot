import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const TONE = {
  green: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/25",
  amber: "bg-warning/10 text-warning ring-1 ring-inset ring-warning/25",
  red: "bg-destructive/10 text-destructive ring-1 ring-inset ring-destructive/25",
  cyan: "bg-accent/10 text-accent ring-1 ring-inset ring-accent/25",
  gray: "bg-muted text-muted-foreground ring-1 ring-inset ring-border",
} as const;

export function Badge({
  tone = "gray",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof TONE }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
