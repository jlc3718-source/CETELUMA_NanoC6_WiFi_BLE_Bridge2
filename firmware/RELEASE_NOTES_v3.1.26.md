# Anderson Home 3.1.26

Complete midnight-blue interface redesign from 3.1.25: integrated house branding, redesigned profile chooser, clearer typography, spacious power controls, paired effect/live-preview cards, refined schedule and settings surfaces, and floating bottom navigation.

Presentation-only changes. All existing UI scripts, control IDs, firmware functions, BLE/Wi-Fi behavior, saved settings, permissions, backup/restore safeguards, OTA verification, and partition layouts remain unchanged. The firmware version constant advances to 3.1.26.

The release gate checks the protected implementation against 3.1.25 and exercises the rendered interface at 320, 390, 768, and 1280 pixels, including restricted-profile visibility. Hardware behavior still requires the physical controller; the automated browser check uses the existing offline preview mode.
