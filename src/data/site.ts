export const SITE_NAME = 'PDFSherpa';
export const CONTACT_EMAIL = (import.meta.env.PUBLIC_CONTACT_EMAIL as string | undefined) || 'hello@pdfsherpa.com';
export const SOURCE_URL = (import.meta.env.PUBLIC_SOURCE_URL as string | undefined) || 'https://github.com/muhammad-wasif-code/pdfnu';
export const LEGAL_UPDATED = '2026-11-16';

/**
 * Official profiles for the brand (schema.org `sameAs`). Only pages that are about PDFSherpa itself,
 * so search engines and AI assistants can tie them to the same entity. Keep this list in sync with real profiles.
 */
export const SAME_AS = [
  SOURCE_URL,
  'https://www.linkedin.com/company/pdfsherpa/',
  'https://thesaasdir.com/product/pdfsherpa',
  'https://launchamp.eu/tools/pdfsherpa',
];

export const ORG_DESCRIPTION = 'Free, open-source PDF and image tools that run entirely in the browser, so files are never uploaded.';

/** The one Organization node, printed on every page so other nodes can point to it by @id. */
export const organizationLd = (site: string) => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': site + '/#organization',
  name: SITE_NAME,
  alternateName: 'PDF Sherpa',
  url: site + '/',
  logo: { '@type': 'ImageObject', url: site + '/icon-512.png', width: 512, height: 512 },
  description: ORG_DESCRIPTION,
  email: CONTACT_EMAIL,
  sameAs: SAME_AS,
});
