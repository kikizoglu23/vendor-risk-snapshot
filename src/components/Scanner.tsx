"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CheckMeta, CheckResult, FollowUp, Priority } from "@/lib/checks/types";
import { ctaHref, reportLink, SITE, socradarToolLinks, VENDOR_EMAIL_SOURCE } from "@/lib/config";
import { normalizeDomain } from "@/lib/domain";
import { collectFollowUps, emailDraft } from "@/lib/questionnaire";
import { CRITICAL_CAP, overallScore } from "@/lib/scoring";
import { GradeBadge, SeverityDot, StatusPill } from "./ui";

type Cell = CheckResult | "loading";
type Results = Record<string, Record<string, Cell>>;

const CONCURRENCY = 6;

function parseInput(text: string): { domains: string[]; invalid: string[] } {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  const domains: string[] = [];
  const invalid: string[] = [];
  for (const t of tokens) {
    const d = normalizeDomain(t);
    if (!d) invalid.push(t);
    else if (!domains.includes(d)) domains.push(d);
  }
  return { domains, invalid };
}

/** Runs async jobs with at most `limit` in flight. */
async function pool(jobs: (() => Promise<void>)[], limit: number) {
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) await jobs[next++]();
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
}

export default function Scanner({ checks }: { checks: CheckMeta[] }) {
  const [input, setInput] = useState("");
  const [results, setResults] = useState<Results>({});
  const [order, setOrder] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const runId = useRef(0);
  /** Set when a vendor arrives through the link in a customer's email. */
  const [vendorVisit, setVendorVisit] = useState<string | null>(null);

  /** Runs the given (domain, check) pairs and writes each result as it arrives. */
  const execute = useCallback(
    async (pairs: { domain: string; checkId: string }[]) => {
      const id = ++runId.current;
      setResults((prev) => {
        const next = { ...prev };
        for (const { domain, checkId } of pairs) next[domain] = { ...next[domain], [checkId]: "loading" };
        return next;
      });
      setRunning(true);
      const jobs = pairs.map(({ domain, checkId }) => async () => {
        let result: CheckResult;
        try {
          const res = await fetch(`/api/checks/${checkId}?domain=${encodeURIComponent(domain)}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          result = await res.json();
        } catch (e) {
          result = {
            checkId,
            domain,
            status: "error",
            score: null,
            summary: `Could not reach the check service (${e instanceof Error ? e.message : "network error"}).`,
            findings: [],
            followUps: [],
            durationMs: 0,
            checkedAt: new Date().toISOString(),
          };
        }
        if (runId.current !== id) return; // a newer run started
        setResults((prev) => ({ ...prev, [domain]: { ...prev[domain], [checkId]: result } }));
      });
      await pool(jobs, CONCURRENCY);
      if (runId.current === id) setRunning(false);
    },
    [],
  );

  const run = useCallback(
    async (text: string) => {
      const { domains, invalid } = parseInput(text);
      if (domains.length === 0) {
        setError(invalid.length ? `Not a valid domain: ${invalid.join(", ")}` : "Enter at least one vendor domain.");
        return;
      }
      if (domains.length > SITE.maxDomains) {
        setError(`You can check up to ${SITE.maxDomains} domains at a time. You entered ${domains.length}.`);
        return;
      }
      setError(invalid.length ? `Skipped invalid entries: ${invalid.join(", ")}` : null);
      setOrder(domains);
      setExpanded(domains.length === 1 ? domains[0] : null);
      setResults({});
      const url = new URL(window.location.href);
      url.searchParams.set("d", domains.join(","));
      window.history.replaceState(null, "", url);
      await execute(domains.flatMap((domain) => checks.map((c) => ({ domain, checkId: c.id }))));
    },
    [checks, execute],
  );

  /** Re-runs only checks whose data source failed (not typos, those won't fix themselves). */
  const retryable = order.flatMap((domain) =>
    checks
      .filter((c) => {
        const cell = results[domain]?.[c.id];
        return cell && cell !== "loading" && cell.status === "error" && !cell.summary.includes("does not exist");
      })
      .map((c) => ({ domain, checkId: c.id })),
  );

  // Shareable links: /?d=acme.com,vendor.io runs immediately.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const d = params.get("d");
    if (d && params.get("utm_source") === VENDOR_EMAIL_SOURCE) setVendorVisit(normalizeDomain(d.split(",")[0]));
    // Keep share links clean: campaign tags are read once, then dropped from the address bar.
    const clean = new URL(window.location.href);
    for (const k of [...clean.searchParams.keys()]) if (k.startsWith("utm_")) clean.searchParams.delete(k);
    window.history.replaceState(null, "", clean);
    if (d) {
      const text = d.split(",").join("\n");
      setInput(text);
      void run(text);
    }
  }, [run]);

  const rows = useMemo(
    () =>
      order.map((domain) => {
        const cells = results[domain] ?? {};
        const done = Object.values(cells).filter((c): c is CheckResult => c !== "loading");
        return { domain, cells, done, complete: done.length === checks.length, overall: overallScore(done, checks) };
      }),
    [order, results, checks],
  );

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {vendorVisit && (
        <aside
          aria-label="Vendor notice"
          className="mb-6 rounded-2xl border border-sky-400/30 bg-sky-500/10 p-5 print:hidden"
        >
          <h2 className="text-lg font-semibold text-white">A customer reviewed {vendorVisit}&apos;s public security posture</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-300">
            Below is exactly what they see, with the evidence behind each item. Customers check vendors before signing and
            after every incident. Catch these findings before they do.
          </p>
          <a
            href={ctaHref("vendor-loop")}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-block rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-200"
          >
            Monitor {vendorVisit} continuously
          </a>
        </aside>
      )}
      {/* Input */}
      <form
        className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl shadow-black/30 sm:p-5 print:hidden"
        onSubmit={(e) => {
          e.preventDefault();
          void run(input);
        }}
      >
        <label htmlFor="domains" className="mb-2 block text-sm font-medium text-slate-300">
          Vendor domains <span className="font-normal text-slate-500">(up to {SITE.maxDomains}, one per line or separated by commas)</span>
        </label>
        <textarea
          id="domains"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void run(input);
          }}
          rows={3}
          spellCheck={false}
          placeholder={"acme.com\npayroll-vendor.io"}
          className="w-full resize-y rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 font-mono text-sm text-slate-100 placeholder:text-slate-600 focus:border-sky-400/60 focus:outline-none focus:ring-2 focus:ring-sky-400/20"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={running}
            className="rounded-xl bg-sky-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 disabled:cursor-wait disabled:opacity-60"
          >
            {running ? "Running checks…" : "Run snapshot"}
          </button>
          <button
            type="button"
            onClick={() => {
              const text = SITE.examples.join("\n");
              setInput(text);
              void run(text);
            }}
            className="text-sm text-slate-400 underline-offset-4 hover:text-slate-200 hover:underline"
          >
            Try an example
          </button>
          <span className="ml-auto text-xs text-slate-500">Passive check, no signup, nothing is stored</span>
        </div>
        {error && <p className="mt-3 text-sm text-amber-300">{error}</p>}
      </form>

      {/* Results */}
      {rows.length > 0 && (
        <section className="mt-8" aria-live="polite">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 className="mr-auto text-lg font-semibold text-slate-100 print:text-slate-900">
              Snapshot of {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </h2>
            <div className="flex flex-wrap gap-2 print:hidden">
              {!running && retryable.length > 0 && (
                <ToolbarButton onClick={() => void execute(retryable)}>
                  Retry {retryable.length} failed check{retryable.length > 1 ? "s" : ""}
                </ToolbarButton>
              )}
              <ToolbarButton onClick={copyLink}>{copied ? "Link copied" : "Copy share link"}</ToolbarButton>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 print:border-slate-300">
            {/* Column header (desktop) */}
            <div
              className="hidden gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-500 md:grid print:grid"
              style={{ gridTemplateColumns: `minmax(0,1.6fr) 7rem repeat(${checks.length}, minmax(0,1fr)) 1.5rem` }}
            >
              <span>Vendor</span>
              <span>Score</span>
              {checks.map((c) => (
                <span key={c.id} className="truncate" title={c.name}>
                  {c.shortName}
                </span>
              ))}
              <span />
            </div>

            {rows.map((row) => {
              const open = expanded === row.domain;
              return (
                <div key={row.domain} className="border-b border-white/10 last:border-b-0 print:break-inside-avoid">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : row.domain)}
                    aria-expanded={open}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03] md:[grid-template-columns:var(--cols)] print:[grid-template-columns:var(--cols)]"
                    style={{ ["--cols" as string]: `minmax(0,1.6fr) 7rem repeat(${checks.length}, minmax(0,1fr)) 1.5rem` }}
                  >
                    <span className="truncate font-mono text-sm text-slate-100 print:text-slate-900">{row.domain}</span>
                    <span className="flex items-center gap-2">
                      <GradeBadge grade={row.complete ? row.overall.grade : null} />
                      <span className="text-sm tabular-nums text-slate-300 print:text-slate-700">
                        {row.complete ? (row.overall.score ?? "-") : "…"}
                        {row.complete && row.overall.score !== null && <span className="text-slate-500">/100</span>}
                      </span>
                    </span>
                    {checks.map((c) => {
                      const cell = row.cells[c.id];
                      return (
                        <span key={c.id} className="hidden md:block print:block">
                          <StatusPill status={cell === "loading" || !cell ? "loading" : cell.status} />
                        </span>
                      );
                    })}
                    <span className={`hidden text-slate-500 transition md:block print:hidden ${open ? "rotate-180" : ""}`}>▾</span>
                  </button>
                  <div className={open ? "block" : "hidden print:block"}>
                    <VendorDetail row={row} checks={checks} />
                  </div>
                </div>
              );
            })}
          </div>
          {rows.length > 1 && !expanded && (
            <p className="mt-2 text-xs text-slate-500 print:hidden">Click a vendor to see the evidence behind each result.</p>
          )}
        </section>
      )}
    </div>
  );
}

function ToolbarButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
    />
  );
}

function VendorDetail({
  row,
  checks,
}: {
  row: { domain: string; cells: Record<string, Cell>; done: CheckResult[]; complete: boolean; overall: ReturnType<typeof overallScore> };
  checks: CheckMeta[];
}) {
  return (
    <div className="border-t border-white/5 bg-slate-950/40 px-4 pb-5 pt-4 print:bg-white">
      {row.complete && row.overall.capped && (
        <p className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 print:text-rose-800">
          Score capped at {CRITICAL_CAP}: at least one critical finding (active compromise or exploited vulnerability) outweighs good results elsewhere.
        </p>
      )}
      {row.complete && row.overall.score !== null && row.overall.scoredChecks < checks.length && (
        <p className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 print:text-amber-800">
          Partial result: {checks.length - row.overall.scoredChecks} of {checks.length} checks could not run, so the score is based on the remaining {row.overall.scoredChecks}.
        </p>
      )}
      <div className="grid gap-3 lg:grid-cols-2">
        {checks.map((c) => {
          const cell = row.cells[c.id];
          const result = cell && cell !== "loading" ? cell : null;
          return (
            <article key={c.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 print:break-inside-avoid print:border-slate-300">
              <header className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-100 print:text-slate-900">{c.name}</h3>
                  <p className="text-xs text-slate-500">{c.question}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {result?.score != null && <span className="text-sm tabular-nums text-slate-400">{result.score}</span>}
                  <StatusPill status={result ? result.status : "loading"} />
                </div>
              </header>
              {result ? (
                <>
                  <p className="mt-3 text-sm text-slate-200 print:text-slate-800">{result.summary}</p>
                  {result.findings.length > 0 && (
                    <ul className="mt-3 space-y-2">
                      {result.findings.map((f, i) => (
                        <li key={i} className="flex gap-2.5 text-sm">
                          <SeverityDot severity={f.severity} />
                          <div className="min-w-0">
                            {f.link ? (
                              <a href={f.link} target="_blank" rel="noreferrer" className="text-slate-200 underline decoration-slate-600 underline-offset-2 hover:decoration-sky-400 print:text-slate-900">
                                {f.title}
                              </a>
                            ) : (
                              <span className="text-slate-200 print:text-slate-900">{f.title}</span>
                            )}
                            {f.detail && <p className="break-words font-mono text-xs text-slate-500">{f.detail}</p>}
                            {f.related && (
                              <a href={f.related.url} target="_blank" rel="noreferrer" className="text-xs text-sky-400 hover:text-sky-300 print:hidden">
                                {f.related.label}
                              </a>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-white/5 pt-2 text-xs text-slate-500">
                    <span>Source:</span>
                    {c.sources.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="hover:text-slate-300">
                        {s.name}
                      </a>
                    ))}
                    <span className="ml-auto tabular-nums">{(result.durationMs / 1000).toFixed(1)}s</span>
                  </footer>
                </>
              ) : (
                <div className="mt-3 space-y-2">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-white/10" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-white/10" />
                </div>
              )}
            </article>
          );
        })}
      </div>
      {row.complete && row.overall.score !== null && <FollowUpPanel domain={row.domain} followUps={collectFollowUps(row.done)} />}
      {row.complete && row.overall.score !== null && <GoDeeper domain={row.domain} />}
    </div>
  );
}

const PRIORITY_STYLE: Record<Priority, string> = {
  critical: "bg-rose-500/15 text-rose-300 ring-rose-500/30 print:text-rose-700",
  high: "bg-orange-500/15 text-orange-300 ring-orange-500/30 print:text-orange-700",
  medium: "bg-amber-500/15 text-amber-200 ring-amber-500/30 print:text-amber-700",
  low: "bg-slate-500/15 text-slate-300 ring-slate-500/30",
};

/** The questions a security / procurement team should send this vendor. */
function FollowUpPanel({ domain, followUps }: { domain: string; followUps: FollowUp[] }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(emailDraft(domain, followUps, { reportUrl: reportLink(window.location.origin, domain) }));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <section
      aria-label="Questions to send this vendor"
      className="mt-4 rounded-xl border border-sky-400/20 bg-sky-500/[0.04] p-4 print:break-inside-avoid print:border-slate-300"
    >
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h3 className="font-semibold text-slate-100 print:text-slate-900">
            Questions to send this vendor <span className="font-normal text-slate-500">({followUps.length})</span>
          </h3>
          <p className="text-xs text-slate-500">Generated from the findings above, most urgent first.</p>
        </div>
        {followUps.length > 0 && (
          <button
            type="button"
            onClick={copy}
            className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-sky-400 print:hidden"
          >
            {copied ? "Email copied" : "Copy as email"}
          </button>
        )}
      </header>
      {followUps.length > 0 ? (
        <ol className="mt-3 space-y-2.5">
          {followUps.map((f, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-5 shrink-0 pt-0.5 text-right tabular-nums text-slate-500">{i + 1}.</span>
              <div className="min-w-0">
                <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${PRIORITY_STYLE[f.priority]}`}>
                  {f.priority}
                </span>
                <span className="text-slate-200 print:text-slate-900">{f.question}</span>
                {f.evidence && (
                  <a href={f.evidence} target="_blank" rel="noreferrer" className="ml-2 text-xs text-slate-500 underline underline-offset-2 hover:text-slate-300">
                    evidence
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-slate-400">
          Nothing in public sources needs clarification from this vendor. Standard due diligence (contract terms, certifications, questionnaire) still applies.
        </p>
      )}
    </section>
  );
}

/** Hand-off to SOCRadar's own tools for what public sources cannot show. */
function GoDeeper({ domain }: { domain: string }) {
  return (
    <section aria-label="Go deeper with SOCRadar" className="mt-4 print:hidden">
      <h3 className="text-sm font-semibold text-slate-200">Go deeper with SOCRadar&apos;s free tools</h3>
      <p className="text-xs text-slate-500">Opens in a new tab. These tools may ask for a quick human check.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {socradarToolLinks(domain).map((l) => (
          <a
            key={l.id}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            data-tool={l.id}
            className="rounded-xl border border-white/10 bg-white/[0.02] p-3 transition hover:border-sky-400/40 hover:bg-white/[0.04]"
          >
            <span className="text-sm font-medium text-sky-300">{l.label}</span>
            <span className="mt-0.5 block text-xs text-slate-400">{l.adds}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
