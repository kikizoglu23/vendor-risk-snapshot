/** Site-wide settings you may want to edit. */
export const SITE = {
  name: "Vendor Risk Snapshot",
  author: "Kerem",
  maxDomains: 10,
  /** Where the "continuous monitoring" call-to-action points (lead-gen funnel). */
  ctaUrl: "https://socradar.io/free-tools/",
  examples: ["canva.com", "dropbox.com", "linkedin.com"],
};

/** Marks traffic that arrives through the link inside a vendor email (the referral loop). */
export const VENDOR_EMAIL_SOURCE = "vendor-email";

/** The CTA link with UTM tags, so sign-ups can be attributed to this tool and to the channel. */
export function ctaHref(campaign: "homepage" | "vendor-loop"): string {
  const url = new URL(SITE.ctaUrl);
  url.searchParams.set("utm_source", "vendor-risk-snapshot");
  url.searchParams.set("utm_medium", "referral");
  url.searchParams.set("utm_campaign", campaign);
  return url.toString();
}

/** Link to a vendor's own report, placed in the email the user sends to that vendor. */
export function reportLink(origin: string, domain: string): string {
  const url = new URL("/", origin);
  url.searchParams.set("d", domain);
  url.searchParams.set("utm_source", VENDOR_EMAIL_SOURCE);
  url.searchParams.set("utm_medium", "email");
  url.searchParams.set("utm_campaign", "vendor-questionnaire");
  return url.toString();
}
