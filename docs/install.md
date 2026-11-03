# Installing Dawn of Worlds

No computer or developer tools are needed. Pick the option for your device.

## iPad / iPhone: web app on the home screen

1. Open **Safari** and go to **https://blynk03.github.io/Dawn-of-Worlds-Mobile/**
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open **Dawn of Worlds** from the home screen. It opens full screen like an app.

**Signing in on iPad/iPhone:** enter your email, then **type the 8-digit code** from the email. Don't tap the link: it opens in Safari, which signs in Safari rather than the home-screen app.

## Android tablet or phone: the app (APK)

1. On the device, open **https://github.com/Blynk03/Dawn-of-Worlds-Mobile/releases/download/android-latest/dawn-of-worlds.apk**
2. Open the downloaded file. If Android asks, allow your browser to **install unknown apps**, then tap **Install**.
3. Google Play Protect may warn that the app isn't from the Play Store. Choose **Install anyway**. It's a test build shared directly, not a store app.

To update, download the same link again and install it over the old one. Your sign-in is kept.

Sign in with your email, then either type the 8-digit code or tap the link in the email on the same device.

**Prefer not to install an APK?** The web app above also works in Chrome on Android: open the link, tap **⋮**, then **Add to Home screen** or **Install app**.

## Any computer

Open **https://blynk03.github.io/Dawn-of-Worlds-Mobile/** in a browser.

## Something's wrong?

- **No email?** Check spam and mark it "Not spam". Codes expire after a while, so request a new one if it's old.
- **"Email link is invalid or has expired"**: request a new code from the sign-in screen.
- **Android won't install, or nothing happens when you tap the file:** on Samsung devices, turn off **Settings → Security and privacy → Auto Blocker** while installing (turn it back on after). You may also need to pause **Play Protect** (Play Store → profile → Play Protect → ⚙️).
- **Download stuck at 100% (about 54 MB) and the file never appears in Files:** the browser isn't finishing the download. Easiest fix: get the file from someone who already has it. On their device, open **Files → Downloads**, long-press `dawn-of-worlds.apk`, tap **Share → Quick Share**, and send it to you. Other things to try: in Chrome, **Settings → Privacy and security → Safe Browsing → Standard protection**, then download again, or use a different browser. Or just use the web app above.
- **Android says "App not installed"** when updating: uninstall the old version first, then install the new one.

---

_For maintainers: the web app is redeployed and the Android APK rebuilt automatically on every merge to `main` (see `.github/workflows/deploy-web.yml` and `android-apk.yml`). iOS App Store / TestFlight and Google Play builds need developer accounts and come with DOW-17._
