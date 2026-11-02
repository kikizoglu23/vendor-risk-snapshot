import Scanner from "@/components/Scanner";
import { ShieldIcon } from "@/components/ui";
import { checkMeta } from "@/lib/checks/registry";
import { SITE } from "@/lib/config";
import { CRITICAL_CAP } from "@/lib/scoring";

export default function Home() {
  const checks = checkMeta();
  const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
  const allSources = [...new Map(checks.flatMap((c) => c.sources).map((s) => [s.name, s])).values()];

  return (
    <div className="relative overflow-x-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[480px] bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.14),transparent_65%)] print:hidden" />

      <header className="relative mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-5 sm:px-6">
        <ShieldIcon className="h-7 w-7 text-sky-400" />
        <span className="font-semibold tracking-tight text-slate-100 print:text-slate-900">{SITE.name}</span>
        <nav className="ml-auto flex gap-5 text-sm text-slate-400 print:hidden">
          <a href="#methodology" className="hover:text-slate-200">Methodology</a>
          <a href="#api" className="hover:text-slate-200">API</a>
        </nav>
      </header>

      <main className="relative mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <section className="pb-8 pt-8 sm:pt-14 print:hidden">
          <p className="mb-3 text-sm font-medium text-sky-400">Free third-party risk check</p>
          <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-5xl">
            Is your vendor a security risk? Find out before you sign.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-slate-400 sm:text-lg">
            Paste your suppliers&apos; domains. In seconds you get an evidence-backed snapshot from open threat-intelligence
            sources — ransomware leak sites, breach history, exploited vulnerabilities and email spoofing protection —
            plus the exact questions to send each vendor, ready to paste into an email.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs text-slate-400">
            {checks.map((c) => (
              <li key={c.id} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">{c.name}</li>
            ))}
          </ul>
        </section>

        <Scanner checks={checks} />

        {/* Call to action — the free tool's job in the funnel */}
        <section className="mt-12 rounded-2xl border border-sky-400/20 bg-gradient-to-br from-sky-500/10 to-transparent p-6 print:hidden">
          <h2 className="text-lg font-semibold text-white">A snapshot is one moment. Your vendors change every day.</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            New leaks, new exploited CVEs and new ransomware listings appear daily. Continuous third-party monitoring alerts
            you the moment one of your suppliers is affected.
          </p>
          <a href={SITE.ctaUrl} target="_blank" rel="noreferrer" className="mt-4 inline-block rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-200">
            Explore continuous monitoring →
          </a>
        </section>

        {/* Methodology — generated from the check registry */}
        <section id="methodology" className="mt-16 scroll-mt-6 print:break-before-page">
          <h2 className="text-2xl font-bold tracking-tight text-white print:text-slate-900">Methodology</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400 print:text-slate-700">
            Every result links to its source. The tool is fully passive: it only queries public intelligence databases and
            DNS — it never connects to or scans the vendor&apos;s servers. It uses organisation-level data only; no personal
            emails or passwords are looked up or shown.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {checks.map((c) => (
              <article key={c.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-5 print:break-inside-avoid print:border-slate-300">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-semibold text-slate-100 print:text-slate-900">{c.name}</h3>
                  <span className="text-xs tabular-nums text-slate-500">weight {Math.round((c.weight / totalWeight) * 100)}%</span>
                </div>
                <p className="mt-1 text-sm italic text-slate-400">{c.question}</p>
                <p className="mt-3 text-sm text-slate-300 print:text-slate-700">{c.whyItMatters}</p>
                <p className="mt-3 text-xs text-slate-500"><span className="font-medium text-slate-400">Limitations: </span>{c.limitations}</p>
                <p className="mt-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-400">Data: </span>
                  {c.sources.map((s, i) => (
                    <span key={s.url}>
                      {i > 0 && ", "}
                      <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-slate-700 underline-offset-2 hover:text-slate-300">{s.name}</a>
                    </span>
                  ))}
                </p>
              </article>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-5 text-sm text-slate-300 print:border-slate-300 print:text-slate-700">
            <h3 className="font-semibold text-slate-100 print:text-slate-900">How the score works</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-400">
              <li>Each check scores the vendor from 0 to 100.</li>
              <li>The overall score is the weighted average (weights above). Checks whose data source is unavailable are left out rather than counted as zero.</li>
              <li>If any check finds something <span className="text-rose-300">critical</span> — a ransomware listing in the last 12 months or a CISA known-exploited vulnerability — the overall score is capped at {CRITICAL_CAP}, so good results elsewhere cannot hide an active problem.</li>
              <li>Grades: A ≥ 90 · B ≥ 75 · C ≥ 60 · D ≥ 40 · F below 40.</li>
            </ol>
            <h3 className="mt-4 font-semibold text-slate-100 print:text-slate-900">Questions for the vendor</h3>
            <p className="mt-1 text-slate-400">
              Each check turns its findings into specific follow-up questions (e.g. a ransomware listing becomes &quot;Was data
              related to our engagement affected?&quot;). They are ranked by urgency and can be copied as an email, so a
              finding becomes an action instead of a number.
            </p>
          </div>
        </section>

        <section id="api" className="mt-12 scroll-mt-6 print:hidden">
          <h2 className="text-2xl font-bold tracking-tight text-white">API</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Each check is an independent endpoint, so you can plug it into procurement or GRC workflows.
          </p>
          <pre className="mt-4 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/70 p-4 text-xs leading-relaxed text-slate-300">
{`GET /api/checks                          # list available checks
GET /api/checks/{id}?domain=acme.com     # run one check
GET /api/scan?domain=acme.com            # run all checks + overall score

check ids: ${checks.map((c) => c.id).join(", ")}`}
          </pre>
        </section>
      </main>

      <footer className="border-t border-white/10 py-8 text-center text-xs text-slate-500 print:border-slate-300">
        <p>Data: {allSources.map((s) => s.name).join(" · ")}</p>
        <p className="mt-1">
          Independent prototype by {SITE.author}, built for the SOCRadar Growth case study. Not an official SOCRadar product.
          Results are indicators from public sources, not a full security assessment.
        </p>
      </footer>
    </div>
  );
}
