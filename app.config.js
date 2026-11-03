// Extends app.json with settings that depend on where the app is built.
//
// EXPO_PUBLIC_BASE_URL: path the web app is served from. GitHub Pages serves it from
// /Dawn-of-Worlds-Mobile; leave unset for local development and native builds.
// ANDROID_VERSION_CODE: build number for Android APKs built in CI, so each one installs as an update.
module.exports = ({ config }) => {
  const baseUrl = (process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  const versionCode = Number.parseInt(process.env.ANDROID_VERSION_CODE ?? '', 10);
  return {
    ...config,
    android: {
      ...config.android,
      ...(Number.isInteger(versionCode) && versionCode > 0 ? { versionCode } : {}),
    },
    experiments: {
      ...config.experiments,
      ...(baseUrl ? { baseUrl } : {}),
    },
  };
};
