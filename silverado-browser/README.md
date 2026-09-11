# Silverado Stream Browser v1.0.2

Android Automotive OS parked-use browser for the 2025 Silverado EV.

This revision replaces the prior GeckoView/Firefox-engine implementation with the vehicle's installed Android WebView provider (Chromium-based on Google Android Automotive builds). The package remains `com.jlc3718.silveradostreambrowser`, versionCode 3, so it is an in-place Play update when signed with the existing upload certificate.

## Netflix-focused changes

- Persistent normal WebView profile; cookies are not cleared at startup or on compatibility-mode changes.
- First- and third-party cookies enabled and flushed on page completion/pause.
- Three compatibility modes that alter the actual WebView user agent and reload the current page: Native WebView, Chrome Android, Chrome Desktop.
- Native diagnostics reports the exact installed WebView provider/version, effective UA, Netflix cookie/session-marker presence without exposing cookie values, Android Widevine support/security level, and whether the loaded page exposes EME.
- HTTPS protected-media permission grants only `RESOURCE_PROTECTED_MEDIA_ID`; camera/microphone permissions are not automatically granted.
- Full-screen video custom view support.
- JavaScript, DOM storage, database storage, hardware acceleration and default HTTP cache are enabled.

This does not spoof a driving-safe app, set `distractionOptimized`, modify GM firmware, or bypass AAOS UX restrictions. It remains parked-use only. Netflix can still reject WebView/custom-browser playback independently of Widevine availability; diagnostics are included so the next failure is evidence-based.

## Build

`gradle :app:bundleRelease :app:assembleRelease`

The release build is deliberately unsigned in CI. Sign the AAB with the existing private Play upload key outside the public repository. Never commit the keystore or password.
