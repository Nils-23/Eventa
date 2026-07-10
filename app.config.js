// Dynamic Expo config: injects the Google Maps API key from the environment so it
// is never committed to source control. Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY in a
// local .env file (gitignored) for `expo start`, and as an EAS environment
// variable / secret for `eas build`.
module.exports = ({ config }) => {
  const mapsKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || '';

  if (config.android && config.android.config && config.android.config.googleMaps) {
    config.android.config.googleMaps.apiKey = mapsKey;
  }

  const mapsPlugin = (config.plugins || []).find(
    (p) => Array.isArray(p) && p[0] === 'react-native-maps'
  );
  if (mapsPlugin && mapsPlugin[1]) {
    mapsPlugin[1].androidGoogleMapsApiKey = mapsKey;
    mapsPlugin[1].iosGoogleMapsApiKey = mapsKey;
  }

  return config;
};
