const { withAndroidManifest } = require('@expo/config-plugins');

/**
 * expo-location's library manifest declares LocationTaskService with
 * android:foregroundServiceType="location". Our manifest declares it too, so the
 * merger fails unless we mark the attribute as an intentional override.
 *
 * This was previously a hand edit in android/app/src/main/AndroidManifest.xml,
 * which prebuild wipes -- and since android/ is gitignored, the loss is invisible
 * until the build fails at manifest merge. Applying it here survives regeneration.
 */
module.exports = function withLocationServiceManifestFix(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';

    const application = manifest.application?.[0];
    if (!application) return config;

    const name = 'expo.modules.location.services.LocationTaskService';
    application.service = application.service || [];

    let service = application.service.find((s) => s.$?.['android:name'] === name);
    if (!service) {
      service = { $: { 'android:name': name, 'android:exported': 'false' } };
      application.service.push(service);
    }

    service.$['android:foregroundServiceType'] = 'location';
    service.$['tools:replace'] = 'android:foregroundServiceType';

    return config;
  });
};
