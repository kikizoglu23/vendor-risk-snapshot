/* eslint-disable @typescript-eslint/no-require-imports -- plain Node script; Playwright is loaded from the global install */
/**
 * End-to-end browser tests against a running server with LIVE data.
 *   APP_URL=http://localhost:3000 npm run test:e2e
 * Saves screenshots and a sample PDF/CSV to E2E_OUT (default: ./e2e-output).
 */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const APP = process.env.APP_URL ?? "http://localhost:3000";
const OUT = process.env.E2E_OUT ?? path.join(__dirname, "..", "e2e-output");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
async function test(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  × ${name}\n      ${String(err.message).split("\n").slice(0, 4).join("\n      ")}`);
  }
}

/** Waits until no cell says "Checking…" any more. */
async function waitForResults(page, timeout = 60_000) {
  await page.waitForFunction(() => document.querySelector("section[aria-live]") && !document.body.innerText.includes("Checking…"), null, { timeout });
}

const rowButtons = (page) => page.locator("section[aria-live] button[aria-expanded]");

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: APP });
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => m.type() === "error" && pageErrors.push(m.text()));

  console.log("Landing page");
  await test("loads with title, 4 check chips, methodology and API docs", async () => {
    await page.goto(APP, { waitUntil: "networkidle" });
    assert.match(await page.title(), /Vendor Risk Snapshot/);
    assert.equal(await page.locator("h1").innerText(), "Is your vendor a security risk? Find out before you sign.");
    for (const name of ["Ransomware leak sites", "Data breach history", "Exposed services & exploited CVEs", "Email spoofing protection"]) {
      assert.ok(await page.locator(`section#methodology h3:text-is("${name}")`).isVisible(), `methodology card ${name}`);
    }
    assert.equal(await page.locator("section#methodology article").count(), 4);
    assert.match(await page.locator("section#api pre").innerText(), /ransomware, breaches, exposed-services, email-security/);
    await page.screenshot({ path: path.join(OUT, "01-landing.png") });
  });

  await test("nav links jump to methodology and API sections", async () => {
    await page.click('nav a[href="#methodology"]');
    assert.ok(page.url().endsWith("#methodology"));
    await page.click('nav a[href="#api"]');
    assert.ok(page.url().endsWith("#api"));
  });

  console.log("Input validation");
  await test("empty submit shows an error and runs nothing", async () => {
    await page.goto(APP);
    await page.click('button[type="submit"]');
    assert.equal(await page.locator("form p.text-amber-300").innerText(), "Enter at least one vendor domain.");
    assert.equal(await page.locator("section[aria-live]").count(), 0);
  });

  await test("only invalid input shows which entries are invalid", async () => {
    await page.fill("#domains", "not_a_domain, localhost");
    await page.click('button[type="submit"]');
    assert.match(await page.locator("form p.text-amber-300").innerText(), /Not a valid domain: not_a_domain, localhost/);
  });

  await test("more than 10 domains is refused", async () => {
    await page.fill("#domains", Array.from({ length: 11 }, (_, i) => `vendor${i}.com`).join("\n"));
    await page.click('button[type="submit"]');
    assert.match(await page.locator("form p.text-amber-300").innerText(), /Up to 10 domains per snapshot — you entered 11/);
  });

  await test("mixed input: invalid skipped, duplicates and URL forms merged", async () => {
    await page.fill("#domains", "https://www.Adobe.com/about\nadobe.com\nnot_a_domain");
    await page.click('button[type="submit"]');
    assert.match(await page.locator("form p.text-amber-300").innerText(), /Skipped invalid entries: not_a_domain/);
    await waitForResults(page);
    assert.equal(await rowButtons(page).count(), 1);
    assert.equal(await rowButtons(page).first().locator("span.font-mono").innerText(), "adobe.com");
  });

  console.log("Single vendor run");
  await test("single domain auto-expands with 4 evidence cards, sources and a grade", async () => {
    const detail = page.locator("section[aria-live] article");
    assert.equal(await detail.count(), 4);
    const grade = (await rowButtons(page).first().locator("span.rounded-xl").innerText()).trim();
    assert.match(grade, /^[ABCDF]$/);
    assert.match(await detail.nth(1).innerText(), /Adobe breach — 2013-10-04/);
    const breachLink = await detail.nth(1).locator("a", { hasText: "Adobe breach" }).getAttribute("href");
    assert.match(breachLink, /^https:\/\/haveibeenpwned\.com\//);
    for (let i = 0; i < 4; i++) assert.match(await detail.nth(i).locator("footer").innerText(), /Source:/);
    await page.screenshot({ path: path.join(OUT, "02-single-vendor.png"), fullPage: true });
  });

  await test("URL is updated to a shareable link", async () => {
    assert.equal(new URL(page.url()).searchParams.get("d"), "adobe.com");
  });

  await test("'Copy share link' puts the URL on the clipboard", async () => {
    await page.click('button:text-is("Copy share link")');
    await page.waitForSelector('button:text-is("Link copied")');
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), page.url());
  });

  await test("clicking the row collapses and re-expands the details", async () => {
    await rowButtons(page).first().click();
    assert.equal(await rowButtons(page).first().getAttribute("aria-expanded"), "false");
    assert.equal(await page.locator("section[aria-live] article").first().isVisible(), false);
    await rowButtons(page).first().click();
    assert.equal(await page.locator("section[aria-live] article").first().isVisible(), true);
  });

  console.log("Multi-vendor run");
  await test("'Try an example' scans 3 vendors and grades each", async () => {
    await page.goto(APP);
    await page.click('button:text-is("Try an example")');
    await waitForResults(page);
    assert.equal(await rowButtons(page).count(), 3);
    for (let i = 0; i < 3; i++) {
      assert.match((await rowButtons(page).nth(i).locator("span.rounded-xl").innerText()).trim(), /^[ABCDF]$/);
    }
    assert.ok(await page.locator("text=Click a vendor to see the evidence").isVisible());
    await page.screenshot({ path: path.join(OUT, "03-multi-vendor.png") });
  });

  await test("only one vendor is expanded at a time", async () => {
    await rowButtons(page).nth(0).click();
    await rowButtons(page).nth(1).click();
    const states = await rowButtons(page).evaluateAll((els) => els.map((e) => e.getAttribute("aria-expanded")));
    assert.deepEqual(states, ["false", "true", "false"]);
  });

  await test("'Export CSV' downloads one row per vendor with every check column", async () => {
    const [download] = await Promise.all([page.waitForEvent("download"), page.click('button:text-is("Export CSV")')]);
    assert.match(download.suggestedFilename(), /^vendor-risk-snapshot-\d{4}-\d{2}-\d{2}\.csv$/);
    const file = path.join(OUT, "export.csv");
    await download.saveAs(file);
    const lines = fs.readFileSync(file, "utf8").trim().split("\n");
    const header = lines[0].split(",");
    assert.match(lines[0], /^"domain","overall_score","grade","ransomware_status","ransomware_score","ransomware_summary","breaches_status"/);
    assert.equal(header.length, 3 + 4 * 3 + 1);
    assert.equal(header.at(-1), '"questions_for_vendor"');
    const text = fs.readFileSync(file, "utf8");
    for (const d of ["canva.com", "dropbox.com", "linkedin.com"]) assert.match(text, new RegExp(`^"${d.replace(".", "\\.")}"`, "m"));
  });

  await test("'Save as PDF' produces a printable report (inputs hidden, all details shown)", async () => {
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator("form").isVisible(), false);
    assert.equal(await page.locator("section[aria-live] article").count(), 12);
    assert.equal(await page.locator("section[aria-live] article").nth(0).isVisible(), true);
    assert.equal(await page.locator('section[aria-label="Questions to send this vendor"]').count(), 3, "questions are part of the report");
    await page.pdf({ path: path.join(OUT, "report.pdf"), format: "A4", printBackground: true });
    await page.emulateMedia({ media: "screen" });
    assert.ok(fs.statSync(path.join(OUT, "report.pdf")).size > 20_000);
  });

  console.log("Shared links & edge cases");
  await test("opening a shared link (?d=...) runs the scan automatically", async () => {
    await page.goto(`${APP}/?d=google.com,dropbox.com`);
    assert.equal(await page.inputValue("#domains"), "google.com\ndropbox.com");
    await waitForResults(page);
    assert.equal(await rowButtons(page).count(), 2);
  });

  await test("a non-existent domain shows 'Unavailable' and no grade", async () => {
    await page.goto(`${APP}/?d=this-domain-does-not-exist-vrs-test.com`);
    await waitForResults(page);
    assert.equal((await rowButtons(page).first().locator("span.rounded-xl").innerText()).trim(), "–");
    assert.equal(await page.locator('section[aria-live] article:has-text("This domain does not exist")').count(), 4);
    assert.equal(await page.locator('button:has-text("failed check")').count(), 0, "typos are not retryable");
    assert.equal(await page.locator('section[aria-label="Questions to send this vendor"]').count(), 0, "no questions without data");
  });

  await test("a critical finding caps the score and explains why", async () => {
    await page.goto(`${APP}/?d=skyplan.com`);
    await waitForResults(page);
    assert.match(await page.locator("text=/Score capped at 49|Listed on a ransomware leak site/").first().innerText(), /.+/);
    const score = Number((await rowButtons(page).first().locator("span.tabular-nums").innerText()).split("/")[0]);
    assert.ok(score <= 49, `score ${score} should be ≤ 49`);
    await page.screenshot({ path: path.join(OUT, "04-critical-vendor.png"), fullPage: true });
  });

  console.log("Questions for the vendor");
  await test("panel lists prioritised questions generated from the findings", async () => {
    const panel = page.locator('section[aria-label="Questions to send this vendor"]');
    assert.ok(await panel.isVisible());
    const items = panel.locator("ol > li");
    assert.ok((await items.count()) >= 3, "expected at least 3 questions");
    assert.match(await items.first().innerText(), /^1\.\s*critical[\s\S]*thegentlemen/i);
    const evidence = await items.first().locator("a", { hasText: "evidence" }).getAttribute("href");
    assert.match(evidence, /^https:\/\/www\.ransomware\.live\//);
  });

  await test("'Copy as email' copies a ready-to-send email", async () => {
    await page.click('button:text-is("Copy as email")');
    await page.waitForSelector('button:text-is("Email copied")');
    const email = await page.evaluate(() => navigator.clipboard.readText());
    assert.match(email, /^Subject: Security follow-up — skyplan\.com\n/);
    assert.match(email, /\n1\. The ransomware group "thegentlemen" listed your organisation/);
    assert.match(email, /Evidence: https:\/\/www\.ransomware\.live\//);
    const link = email.match(/is here:\n(\S+)/)[1];
    const u = new URL(link);
    assert.equal(u.origin, new URL(APP).origin);
    assert.equal(u.searchParams.get("d"), "skyplan.com");
    assert.equal(u.searchParams.get("utm_source"), "vendor-email");
    fs.writeFileSync(path.join(OUT, "email-draft.txt"), email);
  });

  await test("the vendor opening that link sees its own report and a monitoring CTA", async () => {
    await page.goto(`${APP}/?d=skyplan.com&utm_source=vendor-email&utm_medium=email&utm_campaign=vendor-questionnaire`);
    const banner = page.locator('aside[aria-label="Vendor notice"]');
    await banner.waitFor();
    assert.match(await banner.innerText(), /A customer reviewed skyplan\.com/);
    const cta = new URL(await banner.locator("a").getAttribute("href"));
    assert.equal(cta.searchParams.get("utm_campaign"), "vendor-loop");
    assert.equal(cta.searchParams.get("utm_source"), "vendor-risk-snapshot");
    await waitForResults(page);
    assert.equal(await rowButtons(page).count(), 1);
    const params = new URL(page.url()).searchParams;
    assert.equal(params.get("d"), "skyplan.com");
    assert.equal([...params.keys()].some((k) => k.startsWith("utm_")), false, "campaign tags are stripped from share links");
    await page.screenshot({ path: path.join(OUT, "07-vendor-visit.png") });
  });

  await test("a normal visit shows no vendor notice, and the homepage CTA is tagged", async () => {
    await page.goto(`${APP}/?d=skyplan.com`);
    assert.equal(await page.locator('aside[aria-label="Vendor notice"]').count(), 0);
    const cta = new URL(await page.locator('a:text-is("Explore continuous monitoring →")').getAttribute("href"));
    assert.equal(cta.searchParams.get("utm_campaign"), "homepage");
  });

  await test("exploited CVEs link to SOCRadar CVE Radar", async () => {
    await page.goto(`${APP}/?d=skyplan.com`);
    await waitForResults(page);
    const links = page.locator('a:text-is("SOCRadar CVE Radar →")');
    assert.ok((await links.count()) >= 1);
    assert.match(await links.first().getAttribute("href"), /^https:\/\/socradar\.io\/free-tools\/cve-radar\/CVE-\d{4}-\d+$/);
  });

  await test("a vendor with nothing to clarify gets a 'no questions' message, not an empty list", async () => {
    // okta.com passed every check in earlier live scans (live data, so this may change over time)
    await page.goto(`${APP}/?d=okta.com`);
    await waitForResults(page);
    const panel = page.locator('section[aria-label="Questions to send this vendor"]');
    assert.equal(await panel.locator("ol > li").count(), 0);
    assert.match(await panel.innerText(), /Nothing in public sources needs clarification/);
    assert.equal(await panel.locator('button:text-is("Copy as email")').count(), 0);
  });

  console.log("Resilience");
  await test("a data source outage affects only its own check; partial-result note and Retry appear", async () => {
    let failing = true;
    await page.route("**/api/checks/breaches?*", (route) =>
      failing ? route.fulfill({ status: 500, body: "boom" }) : route.continue(),
    );
    await page.goto(`${APP}/?d=adobe.com`);
    await waitForResults(page);
    const cards = page.locator("section[aria-live] article");
    assert.match(await cards.nth(1).innerText(), /Unavailable[\s\S]*Could not reach the check service \(HTTP 500\)/);
    assert.doesNotMatch(await cards.nth(0).innerText(), /Unavailable/);
    assert.ok(await page.locator("text=Partial result: 1 of 4 checks could not run").isVisible());
    await page.screenshot({ path: path.join(OUT, "05-outage.png") });

    failing = false;
    await page.click('button:text-is("Retry 1 failed check")');
    await waitForResults(page);
    assert.match(await cards.nth(1).innerText(), /Adobe breach/);
    assert.equal(await page.locator("text=Partial result").count(), 0);
    assert.equal(await page.locator('button:has-text("failed check")').count(), 0);
    await page.unroute("**/api/checks/breaches?*");
  });

  await test("starting a new scan while one is running discards stale results", async () => {
    await page.goto(APP);
    await page.fill("#domains", "google.com");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(150);
    await page.fill("#domains", "adobe.com");
    await page.evaluate(() => document.querySelector("form").requestSubmit());
    await waitForResults(page);
    const domains = await rowButtons(page).locator("span.font-mono").allInnerTexts();
    // The button is disabled while running, so the second submit may be ignored — either way only ONE domain's rows may exist.
    assert.equal(domains.length, 1);
  });

  console.log("Mobile");
  await test("mobile (390px): no horizontal scrolling, results usable", async () => {
    const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await m.goto(`${APP}/?d=adobe.com`);
    await waitForResults(m);
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `page is ${overflow}px wider than the screen`);
    assert.equal(await m.locator("section[aria-live] article").count(), 4);
    await m.screenshot({ path: path.join(OUT, "06-mobile.png"), fullPage: true });
    await m.close();
  });

  await test("no JavaScript errors in the browser console", async () => {
    // The simulated 500 outage above is expected to log one failed request.
    const unexpected = pageErrors.filter((e) => !/status of 500/.test(e));
    assert.deepEqual(unexpected, []);
  });

  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed. Screenshots: ${OUT}`);
  process.exit(failed.length ? 1 : 0);
})();
