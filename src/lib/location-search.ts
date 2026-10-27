import * as Location from 'expo-location';
const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || '';
export interface LocationResult {
  name: string;
  address: string;
  lat?: number;
  lng?: number;
  placeId?: string;
}
interface Prediction {
  placePrediction?: {
    placeId?: string;
    structuredFormat?: { mainText?: { text?: string }; secondaryText?: { text?: string } };
  };
}
interface Details {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
}
export async function searchLocations(
  query: string,
  options: { signal?: AbortSignal; sessionToken?: string } = {}
): Promise<LocationResult[]> {
  if (GOOGLE_API_KEY) {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      signal: options.signal,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY },
      body: JSON.stringify({ input: query, sessionToken: options.sessionToken }),
    });
    if (!response.ok) throw new Error('Location search is unavailable. Please retry.');
    const data = (await response.json()) as { suggestions?: Prediction[] };
    return (data.suggestions ?? []).slice(0, 5).flatMap((s) =>
      s.placePrediction?.placeId
        ? [
            {
              placeId: s.placePrediction.placeId,
              name: s.placePrediction.structuredFormat?.mainText?.text ?? query,
              address: s.placePrediction.structuredFormat?.secondaryText?.text ?? '',
            },
          ]
        : []
    );
  }
  const geocoded = await Location.geocodeAsync(query);
  return geocoded.slice(0, 5).map((g) => ({
    name: query,
    address: `${g.latitude.toFixed(3)}, ${g.longitude.toFixed(3)}`,
    lat: g.latitude,
    lng: g.longitude,
  }));
}
export async function resolveLocation(
  result: LocationResult,
  sessionToken: string,
  signal?: AbortSignal
): Promise<LocationResult & { lat: number; lng: number }> {
  if (result.lat !== undefined && result.lng !== undefined)
    return { ...result, lat: result.lat, lng: result.lng };
  if (!result.placeId) throw new Error('Choose another location.');
  const response = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(result.placeId)}?sessionToken=${encodeURIComponent(sessionToken)}`,
    {
      signal,
      headers: {
        'X-Goog-Api-Key': GOOGLE_API_KEY,
        'X-Goog-FieldMask': 'location,formattedAddress,displayName',
      },
    }
  );
  if (!response.ok) throw new Error('This location could not be loaded. Please retry.');
  const details = (await response.json()) as Details;
  if (!details.location) throw new Error('Coordinates are unavailable for this location.');
  return {
    ...result,
    name: details.displayName?.text ?? result.name,
    address: details.formattedAddress ?? result.address,
    lat: details.location.latitude,
    lng: details.location.longitude,
  };
}
