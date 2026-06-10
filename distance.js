/**
 * distance.js – Distance module for Eli Movers pricing system.
 *
 * Responsibilities:
 *   1. Normalise Israeli addresses
 *   2. Geocode via Nominatim (primary) → Mapbox (fallback)
 *   3. Calculate driving distance via OSRM
 *   4. Cache geocode results in-memory for 24 h
 *
 * Production scaling note (no code change needed):
 *   - Replace the in-memory Map cache with Redis for multi-process deployments
 *   - Replace Nominatim + OSRM with Google Maps Geocoding + Distance Matrix API
 *     for SLA guarantees, real-time traffic, and higher accuracy
 *   - Use a dedicated service (HERE, Mapbox, Pelias) if request volume grows
 */

// ─── CONFIG ──────────────────────────────────────────────────────────────────

export const distanceConfig = {
  MAPBOX_TOKEN: null,          // Set to your Mapbox access token to enable fallback
  CACHE_TTL_MS: 24 * 60 * 60 * 1000,  // 24 hours
  REQUEST_TIMEOUT_MS: 8_000,
};

// ─── IN-MEMORY CACHE ─────────────────────────────────────────────────────────

/**
 * @type {Map<string, { lat: number, lon: number, timestamp: number }>}
 */
export const geocodeCache = new Map();

// ─── ADDRESS NORMALISATION ───────────────────────────────────────────────────

const ABBR = [
  // Hebrew city abbreviations
  [/\bת[״"']?א\b/g,    'תל אביב'],
  [/\bתא\b/g,          'תל אביב'],
  [/\bירוש[׳']\b/g,   'ירושלים'],
  [/\bירוש\b/g,        'ירושלים'],
  [/\bב[״"']ש\b/g,    'באר שבע'],
  [/\bר[״"']ג\b/g,    'רמת גן'],
  [/\bפ[״"']ת\b/g,    'פתח תקווה'],
  [/\bחי[׳']\b/g,     'חיפה'],
  [/\bנת[׳']\b/g,     'נתניה'],
  // English street-type abbreviations
  [/\bst\b/gi,         'street'],
  [/\bave\b/gi,        'avenue'],
  [/\bblvd\b/gi,       'boulevard'],
  [/\brd\b/gi,         'road'],
  [/\bdr\b/gi,         'drive'],
  [/\bpl\b/gi,         'place'],
  [/\bln\b/gi,         'lane'],
];

/**
 * Normalise an address string for use as a cache key and API query.
 *
 * @param {string} address
 * @returns {string}
 */
export function normalizeAddress(address) {
  if (typeof address !== 'string') return '';

  let s = address.trim().toLowerCase();

  for (const [pattern, replacement] of ABBR) {
    s = s.replace(pattern, replacement);
  }

  // Strip punctuation that adds no geographic meaning
  s = s.replace(/[.,;|"'״׳]/g, '');

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

// ─── CACHE HELPERS ───────────────────────────────────────────────────────────

/**
 * @param {string} key
 * @returns {{ lat: number, lon: number } | null}
 */
function _getCached(key) {
  const entry = geocodeCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > distanceConfig.CACHE_TTL_MS) {
    geocodeCache.delete(key);
    return null;
  }
  return { lat: entry.lat, lon: entry.lon };
}

/**
 * @param {string} key
 * @param {number} lat
 * @param {number} lon
 */
function _setCache(key, lat, lon) {
  geocodeCache.set(key, { lat, lon, timestamp: Date.now() });
}

// ─── FETCH WITH TIMEOUT ──────────────────────────────────────────────────────

/**
 * @param {string} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
function _fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    distanceConfig.REQUEST_TIMEOUT_MS
  );
  return fetch(url, { ...init, signal: controller.signal }).finally(() =>
    clearTimeout(timer)
  );
}

// ─── NOMINATIM GEOCODING ─────────────────────────────────────────────────────

/**
 * Geocode via Nominatim (OpenStreetMap). Returns null on any failure.
 *
 * @param {string} query  normalised address
 * @returns {Promise<{ lat: number, lon: number } | null>}
 */
async function _geocodeNominatim(query) {
  const url =
    'https://nominatim.openstreetmap.org/search' +
    `?format=json&limit=1&countrycodes=il&q=${encodeURIComponent(query)}`;

  const res = await _fetchWithTimeout(url, {
    headers: {
      'Accept-Language': 'he,en',
      'User-Agent': 'EliMovers-PricingSystem/1.0',
    },
  });

  if (!res.ok) return null;

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;

  return {
    lat: parseFloat(data[0].lat),
    lon: parseFloat(data[0].lon),
  };
}

// ─── MAPBOX FALLBACK GEOCODING ────────────────────────────────────────────────

/**
 * Geocode via Mapbox (fallback). Returns null when token is absent or on failure.
 *
 * @param {string} query  normalised address
 * @returns {Promise<{ lat: number, lon: number } | null>}
 */
async function _geocodeMapbox(query) {
  if (!distanceConfig.MAPBOX_TOKEN) return null;

  const url =
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
    `?access_token=${distanceConfig.MAPBOX_TOKEN}&country=il&limit=1`;

  const res = await _fetchWithTimeout(url);
  if (!res.ok) return null;

  const data = await res.json();
  const features = data?.features;
  if (!Array.isArray(features) || features.length === 0) return null;

  const [lon, lat] = features[0].center;
  return { lat, lon };
}

// ─── GEOCODING – PUBLIC ───────────────────────────────────────────────────────

/**
 * @typedef {{ lat: number, lon: number }} Coords
 *
 * @typedef {{
 *   success: true,
 *   lat: number,
 *   lon: number,
 *   fromCache: boolean,
 *   source: 'cache' | 'nominatim' | 'mapbox'
 * }} GeoSuccess
 *
 * @typedef {{ success: false, error: string }} GeoError
 */

/**
 * Resolve an address to lat/lon.
 * Order: cache → Nominatim → Mapbox fallback.
 *
 * @param {string} address
 * @returns {Promise<GeoSuccess | GeoError>}
 */
export async function getCoordinates(address) {
  if (!address || !address.trim()) {
    return { success: false, error: 'Address is empty' };
  }

  const key = normalizeAddress(address);
  if (!key) {
    return { success: false, error: 'Address could not be normalised' };
  }

  // 1. Cache hit
  const cached = _getCached(key);
  if (cached) {
    return { success: true, ...cached, fromCache: true, source: 'cache' };
  }

  // 2. Nominatim
  let coords = null;
  let source = 'nominatim';

  try {
    coords = await _geocodeNominatim(key);
  } catch (_) {
    // Network error or timeout – fall through to Mapbox
  }

  // 3. Mapbox fallback
  if (!coords) {
    source = 'mapbox';
    if (!distanceConfig.MAPBOX_TOKEN) {
      return {
        success: false,
        error:
          'Geocoding failed: Nominatim returned no results and no Mapbox token is configured',
      };
    }
    try {
      coords = await _geocodeMapbox(key);
    } catch (_) {
      return {
        success: false,
        error: 'Geocoding failed: both Nominatim and Mapbox returned errors',
      };
    }
  }

  if (!coords) {
    return {
      success: false,
      error: `No geocoding results found for: "${address}"`,
    };
  }

  // 4. Store result
  _setCache(key, coords.lat, coords.lon);

  return { success: true, ...coords, fromCache: false, source };
}

// ─── OSRM DISTANCE ───────────────────────────────────────────────────────────

/**
 * Calculate driving distance between two coordinate pairs using OSRM.
 *
 * @param {Coords} from
 * @param {Coords} to
 * @returns {Promise<{ distance_km: number } | null>}
 */
async function _calcOsrmDistance(from, to) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;

  const res = await _fetchWithTimeout(url);
  if (!res.ok) return null;

  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.length) return null;

  const meters = data.routes[0].distance;
  return { distance_km: Math.round((meters / 1000) * 100) / 100 };
}

// ─── DISTANCE – PUBLIC ────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   success: true,
 *   distance_km: number,
 *   origin: Coords,
 *   destination: Coords,
 *   cached_origin: boolean,
 *   cached_destination: boolean,
 *   source: 'nominatim' | 'mapbox'
 * }} DistanceResult
 *
 * @typedef {{ success: false, error: string }} DistanceError
 */

/**
 * Return driving distance between two addresses.
 * Geocodes both addresses in parallel, then calls OSRM.
 *
 * @param {string} origin
 * @param {string} destination
 * @returns {Promise<DistanceResult | DistanceError>}
 */
export async function getDistance(origin, destination) {
  if (!origin || !destination) {
    return { success: false, error: 'Both origin and destination are required' };
  }

  const [fromResult, toResult] = await Promise.all([
    getCoordinates(origin),
    getCoordinates(destination),
  ]);

  if (!fromResult.success) {
    return { success: false, error: `Origin – ${fromResult.error}` };
  }
  if (!toResult.success) {
    return { success: false, error: `Destination – ${toResult.error}` };
  }

  const fromCoords = { lat: fromResult.lat, lon: fromResult.lon };
  const toCoords   = { lat: toResult.lat,   lon: toResult.lon   };

  let distResult;
  try {
    distResult = await _calcOsrmDistance(fromCoords, toCoords);
  } catch (err) {
    return {
      success: false,
      error: `Distance calculation failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!distResult) {
    return {
      success: false,
      error: 'OSRM could not calculate a driving route between these addresses',
    };
  }

  // Determine primary geocoding source (prefer non-cache label for transparency)
  const resolvedSource = _resolveSource(fromResult.source, toResult.source);

  return {
    success: true,
    distance_km:        distResult.distance_km,
    origin:             fromCoords,
    destination:        toCoords,
    cached_origin:      fromResult.fromCache,
    cached_destination: toResult.fromCache,
    source:             resolvedSource,
  };
}

// ─── INTERNAL HELPERS ─────────────────────────────────────────────────────────

/**
 * Resolve the "source" label from two geocode results.
 * Prefers non-cache labels; falls back to 'nominatim' when both are cache hits.
 *
 * @param {'cache'|'nominatim'|'mapbox'} a
 * @param {'cache'|'nominatim'|'mapbox'} b
 * @returns {'nominatim'|'mapbox'}
 */
function _resolveSource(a, b) {
  if (a === 'mapbox' || b === 'mapbox') return 'mapbox';
  return 'nominatim';
}
