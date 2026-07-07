import type { LucideIcon } from "lucide-react";
import { motion } from "framer-motion";
import { fadeUp } from "../../lib/motion";
import { useCountUp } from "../../lib/use-count-up";
import { Card } from "./card";
import { cn } from "../../lib/utils";

type Tone = "primary" | "warning" | "muted";

const TONE: Record<Tone, { text: string; chip: string }> = {
  primary: { text: "text-primary", chip: "bg-primary/10 text-primary" },
  warning: { text: "text-warning", chip: "bg-warning/10 text-warning" },
  muted: { text: "text-foreground", chip: "bg-muted text-muted-foreground" },
};

/** Animated headline stat with an icon chip and a count-up value. */
export function StatTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "muted",
  format,
  loading,
}: {
  label: string;
  value: number;
  hint?: string;
  icon: LucideIcon;
  tone?: Tone;
  format: (n: number) => string;
  loading?: boolean;
}) {
  const animated = useCountUp(loading ? 0 : value);
  const t = TONE[tone];
  return (
    <motion.div variants={fadeUp}>
      <Card className="group p-5 hover:-translate-y-0.5 hover:shadow-glow">
        <div className="flex items-start justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
          <span className={cn("grid h-8 w-8 place-items-center rounded-lg transition-transform group-hover:scale-110", t.chip)}>
            <Icon size={16} />
          </span>
        </div>
        <div className={cn("mt-3 text-2xl font-bold tabular-nums", t.text)}>
          {loading ? "—" : format(animated)}
        </div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </Card>
    </motion.div>
  );
}
