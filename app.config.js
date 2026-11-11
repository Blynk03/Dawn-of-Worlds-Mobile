// Extends app.json with settings that depend on where the app is built.
//
// EXPO_PUBLIC_BASE_URL: path the web app is served from. GitHub Pages serves it from
// /Dawn-of-Worlds-Mobile; leave unset for local development and native builds.
// ANDROID_VERSION_CODE: build number for Android APKs built in CI, so each one installs as an update.
// google-services.json: Firebase config for Android push notifications (DOW-16). CI writes it from
// the GOOGLE_SERVICES_JSON secret; it's never committed. Builds without it just skip push.
const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const googleServices = path.join(__dirname, 'google-services.json');
  const baseUrl = (process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  const versionCode = Number.parseInt(process.env.ANDROID_VERSION_CODE ?? '', 10);
  return {
    ...config,
    android: {
      ...config.android,
      ...(Number.isInteger(versionCode) && versionCode > 0 ? { versionCode } : {}),
      ...(fs.existsSync(googleServices) ? { googleServicesFile: './google-services.json' } : {}),
    },
    experiments: {
      ...config.experiments,
      ...(baseUrl ? { baseUrl } : {}),
    },
  };
};
