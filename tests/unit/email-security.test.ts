import { describe, expect, it } from "vitest";
import { scoreDmarc, scoreSpf } from "@/lib/checks/email-security";

describe("scoreSpf (max 40)", () => {
  it.each([
    [["v=spf1 include:_spf.google.com -all"], 40],
    [["v=spf1 include:_spf.google.com ~all"], 30],
    [["v=spf1 ?all"], 10],
    [["v=spf1 +all"], 0],
    [["v=spf1 all"], 0], // no qualifier means "+"
    [["v=spf1 include:x.com"], 20], // no "all" rule
    [[], 0],
    [["google-site-verification=abc", "MS=ms123"], 0], // TXT records but no SPF
    [["v=spf1 -all", "v=spf1 ~all"], 10], // two SPF records are invalid
    [["V=SPF1 -ALL"], 40], // case-insensitive
  ])("%j → %i", (records, points) => {
    expect(scoreSpf(records).points).toBe(points);
  });
});

describe("scoreDmarc (max 60)", () => {
  it.each([
    [["v=DMARC1; p=reject; rua=mailto:x@acme.com"], 60],
    [["v=DMARC1; p=reject; pct=50"], 40],
    [["v=DMARC1; p=quarantine"], 50],
    [["v=DMARC1; p=quarantine; pct=20"], 40],
    [["v=DMARC1; p=none; rua=mailto:x@acme.com"], 20],
    [["v=DMARC1"], 20], // missing p= is treated as none
    [[], 0],
    [["some-other-txt"], 0],
    [["V=DMARC1; P=REJECT"], 60],
  ])("%j → %i", (records, points) => {
    expect(scoreDmarc(records).points).toBe(points);
  });

  it("explains the risk when DMARC is missing", () => {
    expect(scoreDmarc([]).finding).toMatchObject({ severity: "high", title: "No DMARC record" });
  });
});
