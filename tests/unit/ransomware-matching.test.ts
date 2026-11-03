/**
 * Matching rules, tested with record shapes copied from real ransomware.live
 * responses (including the false-positive cases found during testing).
 */
import { describe, expect, it } from "vitest";
import { companyKey, ransomwareCheck, toListing } from "@/lib/checks/ransomware";

const base = { group: "testgroup", attackdate: "2026-10-06T19:26:11+00:00", url: "https://www.ransomware.live/id/abc" };

describe("toListing", () => {
  it("confirms when the domain field equals the vendor domain", () => {
    const l = toListing({ ...base, victim: "Skyplan Services", domain: "skyplan.com" }, "skyplan.com", "skyplan");
    expect(l).toMatchObject({ match: "confirmed", group: "testgroup", date: "2026-10-06", link: base.url });
  });

  it("confirms with www. prefix or a subdomain", () => {
    expect(toListing({ ...base, victim: "PA Composite", domain: "www.pacomposite.com" }, "pacomposite.com", "pacomposite")?.match).toBe("confirmed");
    expect(toListing({ ...base, victim: "X", domain: "mail.acme.com" }, "acme.com", "acme")?.match).toBe("confirmed");
  });

  it("confirms when the victim name is the domain itself", () => {
    expect(toListing({ ...base, victim: "translarity.com", domain: "" }, "translarity.com", "translarity")?.match).toBe("confirmed");
  });

  it("ignores a profile page hosted on the vendor's platform (LinkedIn false positive)", () => {
    const v = { ...base, victim: "SAGAM Groupe - a company with dozens of vulnerabilities", domain: "linkedin.com/company/sagam-groupe" };
    expect(toListing(v, "linkedin.com", "linkedin")).toBeNull();
  });

  it("ignores victims that only mention the brand in their description", () => {
    const v = { ...base, victim: "Rapid Manufacturing", domain: "Rapid Manufacturing", description: "supplier to Millennium Space (Boeing)" };
    expect(toListing(v, "boeing.com", "boeing")).toBeNull();
  });

  it("does not confirm a different domain that merely starts with the vendor's", () => {
    expect(toListing({ ...base, victim: "acme.company.org", domain: "" }, "acme.com", "acme")).toBeNull();
    expect(toListing({ ...base, victim: "x", domain: "notacme.com" }, "acme.com", "acme")).toBeNull();
  });

  it("flags a name-only match as 'possible' when no domain is recorded", () => {
    expect(toListing({ ...base, victim: "Acme", domain: "" }, "acme.com", "acme")?.match).toBe("possible");
    expect(toListing({ ...base, victim: "ACME Inc.", domain: "" }, "acme.com", "acme")?.match).toBe("possible");
  });

  it("treats a company name in the domain field as 'no domain recorded'", () => {
    expect(toListing({ ...base, victim: "Acme", domain: "Acme" }, "acme.com", "acme")?.match).toBe("possible");
  });

  it("does not flag a name match when the record points to another domain", () => {
    expect(toListing({ ...base, victim: "Acme", domain: "acme-industries.de" }, "acme.com", "acme")).toBeNull();
  });

  it("supports legacy field names and missing dates", () => {
    const l = toListing({ post_title: "acme.com", group_name: "oldgang" }, "acme.com", "acme");
    expect(l).toMatchObject({ match: "confirmed", group: "oldgang", date: null });
    expect(l?.link).toContain("ransomware.live/search");
  });
});

describe("companyKey", () => {
  it.each([
    ["ACME Inc.", "acme"],
    ["Acme, LLC", "acme"],
    ["AT&T", "att"],
    ["Acme Holding GmbH", "acmeholding"],
    ["Acme A.Ş.", "acme"],
    ["Inc", "inc"], // never strips the whole name
  ])("%s → %s", (input, expected) => {
    expect(companyKey(input)).toBe(expected);
  });
});

describe("toListing — more false-positive guards", () => {
  it("ignores a victim NAME that is a path on the vendor's platform", () => {
    expect(toListing({ victim: "linkedin.com/company/x", domain: "" }, "linkedin.com", "linkedin")).toBeNull();
  });
  it("does not confirm a different TLD (acme.com.tr is not acme.com)", () => {
    expect(toListing({ victim: "acme.com.tr", domain: "" }, "acme.com", "acme")).toBeNull();
  });
});

describe("listings that name several organisations (supplier / partner incidents)", () => {
  // Real ransomware.live record, Oct 2026: "verveba.com \ www.att.com", domain field empty
  const multi = { victim: "verveba.com \\ www.att.com", domain: "", group: "incransom", attackdate: "2026-10-15" };

  it("matches the vendor anywhere in a multi-domain victim name", () => {
    expect(toListing(multi, "att.com", "att")).toMatchObject({ match: "confirmed", alsoNamed: ["verveba.com"] });
    expect(toListing(multi, "verveba.com", "verveba")).toMatchObject({ match: "confirmed", alsoNamed: ["att.com"] });
    expect(toListing({ victim: "a-corp.com, b-corp.com & acme.com", domain: "" }, "acme.com", "acme")?.alsoNamed).toEqual(["a-corp.com", "b-corp.com"]);
  });

  it("still ignores look-alikes and profile paths inside multi-domain names", () => {
    expect(toListing({ victim: "verveba.com \\ www.hyatt.com", domain: "" }, "att.com", "att")).toBeNull();
    expect(toListing({ victim: "x.com, linkedin.com/company/x", domain: "" }, "linkedin.com", "linkedin")).toBeNull();
  });

  it("flags another organisation named in a SOCRadar record (company differs from the domain)", () => {
    const l = toListing({ victim: "verveba.com", domain: "att.com", group: "INC Ransom" }, "att.com", "att", "SOCRadar");
    expect(l).toMatchObject({ match: "confirmed", alsoNamed: ["verveba.com"] });
  });

  it("asks the vendor whether the other organisation is its supplier", () => {
    const listing = { ...toListing(multi, "att.com", "att")!, date: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) };
    const qs = ransomwareCheck.followUps!({ status: "fail", score: 0, summary: "", findings: [], data: { listings: [listing] } }, "att.com");
    const q = qs.find((x) => x.question.includes("also names"));
    expect(q).toMatchObject({ priority: "high" });
    expect(q?.question).toContain("verveba.com");
    expect(q?.question).toContain("suppliers or partners");
  });
});
