/**
 * Matching rules, tested with record shapes copied from real ransomware.live
 * responses (including the false-positive cases found during testing).
 */
import { describe, expect, it } from "vitest";
import { companyKey, toListing } from "@/lib/checks/ransomware";

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
