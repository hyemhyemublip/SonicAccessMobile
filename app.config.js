/**
 * Dynamic Expo config. Everything static lives in app.json; this layer only
 * decides whether the build is allowed network access.
 *
 * Phase 1 runs fully offline: the app makes no network calls (enrollment is a
 * QR/paste, the code is time-based). So release builds BLOCK the Android
 * INTERNET permission — it is provably offline. The `development` EAS profile
 * sets SONIC_ALLOW_INTERNET=1 so a dev client can still reach Metro.
 */

module.exports = ({ config }) => {
  const allowInternet = process.env.SONIC_ALLOW_INTERNET === '1';

  if (!allowInternet) {
    config.android = config.android || {};
    config.android.blockedPermissions = Array.from(
      new Set([
        ...(config.android.blockedPermissions || []),
        'android.permission.INTERNET',
      ]),
    );
  }

  return config;
};
