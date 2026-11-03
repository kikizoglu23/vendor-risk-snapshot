import type { CheckStatus, Severity } from "@/lib/checks/types";
import type { Grade } from "@/lib/scoring";

const STATUS_STYLE: Record<CheckStatus | "loading", { label: string; cls: string }> = {
  pass: { label: "Pass", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30 print:text-emerald-700" },
  warn: { label: "Review", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30 print:text-amber-700" },
  fail: { label: "Risk", cls: "bg-rose-500/15 text-rose-300 ring-rose-500/30 print:text-rose-700" },
  error: { label: "Unavailable", cls: "bg-slate-500/15 text-slate-400 ring-slate-500/30" },
  loading: { label: "Checking…", cls: "bg-sky-500/10 text-sky-300 ring-sky-500/20 animate-pulse" },
};

export function StatusPill({ status }: { status: CheckStatus | "loading" }) {
  const s = STATUS_STYLE[status];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      {s.label}
    </span>
  );
}

const GRADE_STYLE: Record<Grade, string> = {
  A: "bg-emerald-500 text-emerald-950",
  B: "bg-lime-400 text-lime-950",
  C: "bg-amber-400 text-amber-950",
  D: "bg-orange-500 text-orange-950",
  F: "bg-rose-500 text-rose-950",
};

export function GradeBadge({ grade, size = "md" }: { grade: Grade | null; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "h-14 w-14 text-2xl" : "h-9 w-9 text-base";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl font-bold ${dim} ${
        grade ? GRADE_STYLE[grade] : "bg-slate-700 text-slate-400"
      }`}
    >
      {grade ?? "-"}
    </span>
  );
}

const SEVERITY_DOT: Record<Severity, string> = {
  critical: "bg-rose-500",
  high: "bg-orange-400",
  medium: "bg-amber-300",
  low: "bg-sky-400",
  info: "bg-slate-500",
};

export function SeverityDot({ severity }: { severity: Severity }) {
  return <span title={severity} className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[severity]}`} />;
}

export function ShieldIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className} aria-hidden>
      <path d="M12 3l7 3v5c0 4.5-3 8.5-7 10-4-1.5-7-5.5-7-10V6l7-3z" strokeLinejoin="round" />
      <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
