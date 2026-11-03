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
  return tagged(SITE.ctaUrl, campaign);
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

function tagged(url: string, campaign: string): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", "vendor-risk-snapshot");
  u.searchParams.set("utm_medium", "referral");
  u.searchParams.set("utm_campaign", campaign);
  return u.toString();
}

/**
 * Hand-off links to SOCRadar's own free tools for a vendor. These tools are
 * protected by a human check and a daily limit, so instead of pulling their
 * data we send the user there: the check runs in the user's own browser.
 */
export function socradarToolLinks(domain: string): { id: string; label: string; adds: string; url: string }[] {
  const d = encodeURIComponent(domain);
  return [
    {
      id: "dark-web-report",
      label: "Dark Web Report",
      adds: "Stealer logs, leaked credentials and dark-web mentions for this vendor",
      url: tagged(`https://socradar.io/free-tools/dark-web-report?domain=${d}`, "deep-link-dark-web"),
    },
    {
      id: "external-attack-surface",
      label: "External Attack Surface",
      adds: "All subdomains, technologies and exposed services, not just the main website",
      url: tagged(`https://socradar.io/free-tools/external-attack-surface?domain=${d}`, "deep-link-attack-surface"),
    },
  ];
}
