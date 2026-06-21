// ============================================================
// !!!  STOP — READ THIS BEFORE DEPLOYING  !!!
//
// All four values below are PLACEHOLDERS.
// Replace EACH one with the real value from your ad accounts
// before pushing to production.  Search for "REPLACE_ME" to
// find every placeholder in this file.
//
// HOW TO GET EACH VALUE:
//   GA4_MEASUREMENT_ID   → Google Analytics → Admin → Data Streams
//                          → your web stream → "Measurement ID" (G-XXXXXXXX)
//   META_PIXEL_ID        → Meta Events Manager → your Pixel → Settings
//                          → "Pixel ID" (15-17 digit number)
//   GOOGLE_ADS_CONVERSION_ID    → Google Ads → Goals → Conversions
//                                 → your conversion action → "Tag details"
//                                 → look for AW-XXXXXXXXX (the part after AW-)
//   GOOGLE_ADS_CONVERSION_LABEL → same "Tag details" page
//                                 → the label string after the slash e.g. "AbCdEfGhIjKl"
// ============================================================
var TRACKING_CONFIG = {
  GA4_MEASUREMENT_ID:          'REPLACE_ME_GA4_ID',           // e.g. "G-XXXXXXXXXX"
  META_PIXEL_ID:               'REPLACE_ME_META_PIXEL_ID',    // e.g. "1234567890123456"
  GOOGLE_ADS_CONVERSION_ID:    'REPLACE_ME_GADS_CONV_ID',     // e.g. "123456789"
  GOOGLE_ADS_CONVERSION_LABEL: 'REPLACE_ME_GADS_CONV_LABEL'  // e.g. "AbCdEfGhIjKl"
};

// ── Guard: skip everything if placeholders were not replaced ──
var GA4_READY  = TRACKING_CONFIG.GA4_MEASUREMENT_ID  !== 'REPLACE_ME_GA4_ID';
var PIXEL_READY = TRACKING_CONFIG.META_PIXEL_ID       !== 'REPLACE_ME_META_PIXEL_ID';
var GADS_READY  = TRACKING_CONFIG.GOOGLE_ADS_CONVERSION_ID !== 'REPLACE_ME_GADS_CONV_ID' &&
                  TRACKING_CONFIG.GOOGLE_ADS_CONVERSION_LABEL !== 'REPLACE_ME_GADS_CONV_LABEL';

// ── Google tag (gtag.js) — loads GA4 + Google Ads via one script ──
if (GA4_READY || GADS_READY) {
  (function() {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' +
            (GA4_READY
              ? 'G-' + TRACKING_CONFIG.GA4_MEASUREMENT_ID.replace(/^G-/, '')
              : 'AW-' + TRACKING_CONFIG.GOOGLE_ADS_CONVERSION_ID);
    document.head.appendChild(s);
  })();

  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('js', new Date());

  if (GA4_READY) {
    gtag('config', TRACKING_CONFIG.GA4_MEASUREMENT_ID);
  }
  if (GADS_READY) {
    gtag('config', 'AW-' + TRACKING_CONFIG.GOOGLE_ADS_CONVERSION_ID);
  }
}

// ── Meta Pixel ──────────────────────────────────────────────
if (PIXEL_READY) {
  (function(f, b, e, v, n, t, s) {
    if (f.fbq) return;
    n = f.fbq = function() {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n; n.loaded = true; n.version = '2.0';
    n.queue = [];
    t = b.createElement(e); t.async = true;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', TRACKING_CONFIG.META_PIXEL_ID);
  fbq('track', 'PageView');
}

// ── trackLead(method, location) ──────────────────────────────
// Sends GA4 + Meta Pixel + Google Ads conversion on every lead click.
// Uses sendBeacon where available so the event survives page navigation
// (tel: / wa.me links cause immediate browser navigation).
window.trackLead = function(method, location) {
  // GA4
  if (GA4_READY && window.gtag) {
    gtag('event', 'generate_lead', {
      method: method,        // 'whatsapp' | 'phone'
      location: location     // e.g. 'hero', 'floating_button', …
    });
  }

  // Meta Pixel — fbq() queues internally, so it's safe even during unload
  if (PIXEL_READY && window.fbq) {
    fbq('track', 'Lead', { content_name: method, content_category: location });
  }

  // Google Ads conversion
  if (GADS_READY && window.gtag) {
    gtag('event', 'conversion', {
      send_to: 'AW-' + TRACKING_CONFIG.GOOGLE_ADS_CONVERSION_ID +
               '/' + TRACKING_CONFIG.GOOGLE_ADS_CONVERSION_LABEL
    });
  }
};

// ── Event delegation: one listener for ALL tel: and wa.me links ─
// Covers static links AND the dynamically-built qwWaBtn in the quote wizard.
document.addEventListener('click', function(e) {
  var link = e.target.closest('a[href^="tel:"], a[href*="wa.me"]');
  if (!link) return;

  var href   = link.getAttribute('href') || '';
  var method = href.indexOf('wa.me') !== -1 ? 'whatsapp' : 'phone';
  // Read explicit location attribute; fall back to a generic label
  var location = link.getAttribute('data-lead-location') || 'unknown';

  window.trackLead(method, location);
}, { passive: true });
