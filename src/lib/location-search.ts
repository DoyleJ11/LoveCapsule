/**
 * Location search using Google Places API.
 *
 * Uses a two-strategy approach for best results:
 * 1. Places Autocomplete (New) — fast prefix-based suggestions as you type
 * 2. Places Text Search (New) — full text search fallback for place names
 *    that autocomplete doesn't find (e.g., "The Victor Apartments")
 *
 * Falls back to expo-location geocoding if no Google API key is configured.
 */
import * as Location from 'expo-location';

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';

export interface LocationResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  placeId?: string;
}

/**
 * Search for locations by name or address.
 * Returns up to 5 results with coordinates.
 */
export async function searchLocations(query: string): Promise<LocationResult[]> {
  if (!GOOGLE_API_KEY) {
    return searchWithExpoLocation(query);
  }

  // Try autocomplete first (fast, good for addresses and well-known places)
  const autocompleteResults = await searchWithAutocomplete(query);
  if (autocompleteResults.length > 0) {
    return autocompleteResults;
  }

  // Fall back to text search (better for place names, business names)
  const textSearchResults = await searchWithTextSearch(query);
  if (textSearchResults.length > 0) {
    return textSearchResults;
  }

  // Final fallback: expo-location geocoding
  return searchWithExpoLocation(query);
}

// --------------- Google Places Autocomplete (New) ---------------

async function searchWithAutocomplete(query: string): Promise<LocationResult[]> {
  try {
    const url = 'https://places.googleapis.com/v1/places:autocomplete';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
      },
      body: JSON.stringify({
        input: query,
        // No type filter — allow ALL place types for maximum coverage
      }),
    });

    if (!response.ok) {
      console.warn('Places Autocomplete failed:', response.status);
      return [];
    }

    const data = await response.json();
    const suggestions = data.suggestions || [];
    if (suggestions.length === 0) return [];

    return resolveAutocompleteResults(suggestions.slice(0, 5));
  } catch (error) {
    console.warn('Places Autocomplete error:', error);
    return [];
  }
}

async function resolveAutocompleteResults(suggestions: any[]): Promise<LocationResult[]> {
  const results: LocationResult[] = [];

  // Fetch details for all suggestions in parallel
  const promises = suggestions.map(async (suggestion) => {
    const placePrediction = suggestion.placePrediction;
    if (!placePrediction?.placeId) return null;

    const placeId = placePrediction.placeId;
    const mainText = placePrediction.structuredFormat?.mainText?.text || '';
    const secondaryText = placePrediction.structuredFormat?.secondaryText?.text || '';

    try {
      const detailsUrl = `https://places.googleapis.com/v1/places/${placeId}`;
      const detailsResponse = await fetch(detailsUrl, {
        headers: {
          'X-Goog-Api-Key': GOOGLE_API_KEY,
          'X-Goog-FieldMask': 'location,formattedAddress,displayName',
        },
      });

      if (!detailsResponse.ok) return null;
      const details = await detailsResponse.json();

      if (details.location) {
        return {
          name: details.displayName?.text || mainText,
          address: details.formattedAddress || secondaryText,
          lat: details.location.latitude,
          lng: details.location.longitude,
          placeId,
        } as LocationResult;
      }
    } catch {
      // Skip failed detail fetches
    }
    return null;
  });

  const resolved = await Promise.all(promises);
  for (const r of resolved) {
    if (r) results.push(r);
  }

  return results;
}

// --------------- Google Places Text Search (New) ---------------
// Text Search is better at finding places by name (e.g., "Bloedel Reserve",
// "The Victor Apartments") because it does full-text matching, not just
// prefix matching like Autocomplete.

async function searchWithTextSearch(query: string): Promise<LocationResult[]> {
  try {
    const url = 'https://places.googleapis.com/v1/places:searchText';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.id',
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: 5,
      }),
    });

    if (!response.ok) {
      console.warn('Places Text Search failed:', response.status);
      return [];
    }

    const data = await response.json();
    const places = data.places || [];

    return places.map((place: any) => ({
      name: place.displayName?.text || query,
      address: place.formattedAddress || '',
      lat: place.location?.latitude || 0,
      lng: place.location?.longitude || 0,
      placeId: place.id,
    }));
  } catch (error) {
    console.warn('Places Text Search error:', error);
    return [];
  }
}

// --------------- Fallback: expo-location ---------------

async function searchWithExpoLocation(query: string): Promise<LocationResult[]> {
  try {
    const geocoded = await Location.geocodeAsync(query);
    if (geocoded.length === 0) return [];

    const results: LocationResult[] = [];
    for (const geo of geocoded.slice(0, 5)) {
      try {
        const [address] = await Location.reverseGeocodeAsync({
          latitude: geo.latitude,
          longitude: geo.longitude,
        });
        const name = [address?.name, address?.city, address?.region].filter(Boolean).join(', ');
        results.push({
          name: name || query,
          address: [address?.street, address?.city, address?.region, address?.postalCode]
            .filter(Boolean)
            .join(', '),
          lat: geo.latitude,
          lng: geo.longitude,
        });
      } catch {
        results.push({ name: query, address: '', lat: geo.latitude, lng: geo.longitude });
      }
    }
    return results;
  } catch {
    return [];
  }
}
