# Jason Home APK signing

Jason Home uses one permanent APK signing certificate so Android can install each future version as an upgrade without removing the prior version.

Build pipeline:
1. GitHub Actions builds an unsigned release APK.
2. The APK is signed outside the public repository with the permanent Jason Home signing key stored privately in the user's ChatGPT Library under /JasonHome/Signing/.
3. Only the permanently signed APK should be given to the user for installation.

Do not commit the keystore or password to this public repository.
Do not distribute the GitHub UNSIGNED artifact as an installable build.

Permanent signer certificate SHA-256:
76:B2:8E:FD:4F:5D:13:2A:D3:04:8F:19:BA:E6:C3:5A:A5:F8:4C:4A:39:0E:98:C8:0D:EE:EB:C0:C3:E7:3A:E1
