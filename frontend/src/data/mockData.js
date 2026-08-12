// =============================================================================
// IWM — Static reference data (not backend data).
// Everything that used to live here as fabricated demo numbers now comes
// from the real API via src/services/*.js. Only genuine, fixed reference
// lists remain: things the UI needs to render forms/dropdowns regardless of
// which backend is behind it.
// =============================================================================

export const CANADIAN_LOCATIONS = [
  { city: 'Toronto', province: 'ON' },
  { city: 'Vancouver', province: 'BC' },
  { city: 'Calgary', province: 'AB' },
  { city: 'Montreal', province: 'QC' },
  { city: 'Ottawa', province: 'ON' },
  { city: 'Edmonton', province: 'AB' },
];

// Waste categories, mirroring CATEGORY_COLORS in the readings Lambda
// (aws/lambdas/readings/lambda_function.py).
//
// A scale reports its category in Message2, but that field doubles as a device
// event log — "Wifi Reconnected" and blanks also arrive there. Only these three
// strings count as categories; everything else is bucketed as Uncategorised and
// must not be read as waste. `key` is the exact Message2 value, so it can be
// compared against an API response without translation.
//
// These replaced a set of invented food groups (Vegetables, Dairy, Meat…) that
// no reading has ever carried, so every filter built on them matched nothing.
export const WASTE_CATEGORIES = [
  { key: 'Overproduction', label: 'Overproduction', color: '#EF4444' },
  { key: 'Prep Waste', label: 'Prep Waste', color: '#F59E0B' },
  { key: 'Storage EXP', label: 'Storage EXP', color: '#A78BFA' },
];

/** The bucket the API assigns to anything Message2 doesn't match. */
export const UNCATEGORISED = { key: 'Uncategorised', label: 'Uncategorised', color: '#64748B' };

/** Every bucket a category-breakdown response can contain. */
export const ALL_CATEGORIES = [...WASTE_CATEGORIES, UNCATEGORISED];
