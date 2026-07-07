import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

const TONE = {
  green: "bg-primary/10 text-primary",
  amber: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  red: "bg-destructive/10 text-destructive",
  gray: "bg-muted text-muted-foreground",
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
