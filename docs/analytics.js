// Matomo tracking. Unlike dubsector.dev and grandtotal, this site is static
// GitHub Pages with no Worker in front, so there is nothing to proxy the
// requests through: they go straight to the analytics host, and the site id is
// baked in rather than fetched from an /api/analytics endpoint. Neither is a
// secret - the id is visible in every tracking request anyway.
//
// The paths below are deliberately not the stock matomo.js and matomo.php,
// which generic filter-list rules match by name on any host. Caddy on the
// analytics host rewrites /assets/sd.js and /assets/sd back to the real files,
// so this is the only place the mapping is written down.

(function () {
  "use strict";

  var SITE_ID = 3;

  var ANALYTICS_HOST = "https://analytics.dubsector.dev/";

  // Only the published site reports. Local preview runs on port 5573 against
  // the same docs/ directory, and counting those would put a day of development
  // on top of a site that sees modest real traffic.
  var PRODUCTION_HOST = "dubsector.github.io";

  if (window.location.hostname !== PRODUCTION_HOST) return;

  var _paq = (window._paq = window._paq || []);

  // Cookieless keeps the site out of consent-banner territory: with no cookies,
  // anonymized IPs and a self-hosted install, Matomo qualifies for the
  // CNIL-style consent exemption. The cost is that returning visitors stop
  // being identifiable past the ~24h config-id window, which matters little on
  // a single page with no accounts.
  _paq.push(["disableCookies"]);
  _paq.push(["setDoNotTrack", true]);
  _paq.push(["setTrackerUrl", ANALYTICS_HOST + "assets/sd"]);
  _paq.push(["setSiteId", String(SITE_ID)]);
  _paq.push(["trackPageView"]);
  // The footer links out to bStats, the Fill API docs, GitHub and dubsector.dev,
  // so outbound clicks are worth having.
  _paq.push(["enableLinkTracking"]);

  var script = document.createElement("script");
  script.async = true;
  script.src = ANALYTICS_HOST + "assets/sd.js";
  document.head.appendChild(script);
})();
