import Scanner from "@/components/Scanner";
import { ShieldIcon } from "@/components/ui";
import { checkMeta } from "@/lib/checks/registry";
import { ctaHref, SITE } from "@/lib/config";

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
            Paste your suppliers&apos; domains to see what public threat intelligence shows about each one, and get the
            questions to send them.
          </p>
          <ul className="mt-5 flex flex-wrap gap-2 text-xs text-slate-400">
            {checks.map((c) => (
              <li key={c.id} className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1">{c.name}</li>
            ))}
          </ul>
        </section>

        <Scanner checks={checks} />

        {/* Call to action: the free tool's job in the funnel */}
        <section className="mt-12 rounded-2xl border border-sky-400/20 bg-gradient-to-br from-sky-500/10 to-transparent p-6 print:hidden">
          <h2 className="text-lg font-semibold text-white">A snapshot is one moment. Your vendors change every day.</h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-400">
            New leaks, new exploited CVEs and new ransomware listings appear daily. Continuous third-party monitoring alerts
            you the moment one of your suppliers is affected.
          </p>
          <a href={ctaHref("homepage")} target="_blank" rel="noreferrer" className="mt-4 inline-block rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-200">
            Explore continuous monitoring
          </a>
        </section>

        {/* Methodology, generated from the check registry */}
        <section id="methodology" className="mt-16 scroll-mt-6">
          <h2 className="text-2xl font-bold tracking-tight text-white">Methodology</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">
            Every result links to its source. The tool only reads public databases and DNS. It never scans the vendor&apos;s
            servers or looks up personal data.
          </p>
          <div className="mt-5 divide-y divide-white/10 rounded-xl border border-white/10">
            {checks.map((c) => (
              <article key={c.id} className="grid gap-1 p-4 sm:grid-cols-[14rem_1fr] sm:gap-4">
                <h3 className="font-semibold text-slate-100">
                  {c.name} <span className="text-xs font-normal tabular-nums text-slate-500">{Math.round((c.weight / totalWeight) * 100)}%</span>
                </h3>
                <div className="text-sm text-slate-400">
                  <p>
                    {c.sources.map((src, i) => (
                      <span key={src.url}>
                        {i > 0 && ", "}
                        <a href={src.url} target="_blank" rel="noreferrer" className="underline decoration-slate-700 underline-offset-2 hover:text-slate-200">{src.name}</a>
                      </span>
                    ))}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">{c.limitations}</p>
                </div>
              </article>
            ))}
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
        <p>Data: {allSources.map((s) => s.name).join(", ")}</p>
        <p className="mt-1">
          Independent prototype by {SITE.author}, built for the SOCRadar Growth case study. Not an official SOCRadar product.
          Results are indicators from public sources, not a full security assessment.
        </p>
      </footer>
    </div>
  );
}
