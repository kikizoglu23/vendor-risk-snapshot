import { describe, expect, it } from "vitest";
import { brandLabel, normalizeDomain } from "@/lib/domain";

describe("normalizeDomain", () => {
  it.each([
    ["acme.com", "acme.com"],
    ["  ACME.com  ", "acme.com"],
    ["https://www.acme.com/about?x=1", "acme.com"],
    ["http://acme.com:8080", "acme.com"],
    ["jane.doe@acme.com", "acme.com"],
    ["acme.com.", "acme.com"],
    ["shop.acme.co.uk", "shop.acme.co.uk"],
    ["münchen.de", "xn--mnchen-3ya.de"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(["", "   ", "not_a_domain", "localhost", "acme", "192.168.1.1", "acme..com", "-acme.com", "http://", "a".repeat(64) + ".com"])(
    "rejects %j",
    (input) => {
      expect(normalizeDomain(input)).toBeNull();
    },
  );
});

describe("brandLabel", () => {
  it.each([
    ["acme.com", "acme"],
    ["shop.acme.com", "acme"],
    ["acme.co.uk", "acme"],
    ["shop.acme.com.tr", "acme"],
    ["acme.io", "acme"],
  ])("%s -> %s", (input, expected) => {
    expect(brandLabel(input)).toBe(expected);
  });
});
