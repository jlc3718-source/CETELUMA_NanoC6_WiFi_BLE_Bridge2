# Betabound physical-product tests — no paid browser service

Independent from the home-control projects; never uses TinyFish, ChatGPT Work, or the Oracle runner.

## Android application helper

1. Install Firefox for Android, then its Violentmonkey or Tampermonkey extension.
2. In Firefox, open https://raw.githubusercontent.com/jlc3718-source/CETELUMA_NanoC6_WiFi_BLE_Bridge2/main/betabound/betabound-physical.user.js and select Install in your userscript manager.
3. Open https://my.betabound.com/key/GasGrill26 in the SAME Firefox browser and sign in using the normal Continue with Google.
4. At the bottom of the Betabound page, choose Import Profile, select your locally downloaded JSON contact-profile file, then choose Start All.
5. The helper queues all three known product opportunities and any other physical-product links visible on the signed-in dashboard. It fills only verified contact details and pauses on unknown screener questions, NDAs/legal agreements, authentication, or ambiguous submissions.

Privacy: The script never exports session cookies or Google credentials. Contact details are saved only in that browser's local storage; no data is uploaded to GitHub. No external endpoints other than the Betabound website are contacted.

## GitHub-hosted public scan

Use Actions > Betabound Physical Product Tests. The default scan mode checks the public status of the three opportunities on a standard free GitHub-hosted Ubuntu runner. It cannot access Google sign-in or your private applications by itself.

No accepted/submitted application is claimed unless Betabound visibly confirms submission. The runner's optional authenticated mode should remain unused until a secure user-controlled authentication setup exists.

Never post passwords, Google sessions, cookies, or encoded personal details into issues, Actions inputs, public repo files, logs, or chat.
