/**
 * Directory / launch-site badges shown on /featured.
 * Each `html` string is rendered verbatim (set:html) because directories crawl the raw HTML
 * to verify their badge: do not change href, src, alt, rel or sizes, and do not add
 * nofollow/ugc/sponsored, lazy-loading or image proxying.
 */
export const FEATURED_BADGES: { name: string; html: string }[] = [
  {
    name: 'TheSaaSDir',
    html: `<a href="https://thesaasdir.com/product/pdfsherpa?ref=badge" rel="dofollow">
<img src="https://thesaasdir.com/badge/pdfsherpa.svg" alt="Featured on TheSaaSDir" width="182" height="46">
</a>`,
  },
  {
    name: 'LaunchBison',
    html: `<a href="https://launchbison.com" target="_blank" rel="noopener">
<img src="https://launchbison.com/badge-light.png" alt="Featured on Launchbison" width="198" height="62" />
</a>`,
  },
  {
    name: 'SumoDir',
    html: `<a href="https://sumodir.com" target="_blank" rel="dofollow"><img src="https://sumodir.com/badge.png" alt="Featured on SumoDir" width="200" height="54" /></a>`,
  },
  {
    name: 'Findly.tools',
    html: `<a href="https://findly.tools/pdfsherpa?utm_source=pdfsherpa" target="_blank" rel="noopener noreferrer">
<img src="https://findly.tools/badges/findly-tools-badge-light.svg" alt="Featured on Findly.tools" width="175" height="55" />
</a>`,
  },
  {
    name: 'MegaLaunch',
    html: `<a href="https://megalaun.ch/" target="_blank" rel="noopener"><img src="https://megalaun.ch/badges/featured/asset" alt="Featured on MegaLaunch" width="220" height="64" /></a>`,
  },
  {
    name: 'LaunchAmp',
    html: `<a href="https://launchamp.eu/tools/pdfsherpa" target="_blank" rel="noopener"> <img src="https://launchamp.eu/assets/images/badges/badge_launchamp_light.svg" alt="Approved on LaunchAmp" width="220" height="54"> </a>`,
  },
  {
    name: 'SaaSDB',
    html: `<a href="https://saasdb.net" rel="dofollow">
<img src="https://saasdb.net/badge/featured-light.svg" alt="Featured on SaaSDB" width="300" />
</a>`,
  },
];
