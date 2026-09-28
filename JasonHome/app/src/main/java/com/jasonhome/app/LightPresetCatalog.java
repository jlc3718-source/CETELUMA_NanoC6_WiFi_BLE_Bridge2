package com.jasonhome.app;

final class LightPresetCatalog {
    static final class EffectTemplate {
        final String name;
        final String family;
        final String description;
        EffectTemplate(String name, String family, String description) {
            this.name = name; this.family = family; this.description = description;
        }
    }

    static final class NamedColor {
        final String name;
        final int rgb;
        final boolean anderson;
        NamedColor(String name, int rgb, boolean anderson) {
            this.name = name; this.rgb = rgb; this.anderson = anderson;
        }
    }

    // Human-facing templates built from Eufy's native 0x020D layer engine.
    // Names are Jason Home UI names; the device wire uses layer types/parameters, not these labels.
    static final EffectTemplate[] EFFECTS = {
        new EffectTemplate("Solid / Static", "Static", "Applies Color 1 and holds it with no motion."),
        new EffectTemplate("Jump", "Full-string color cycle", "The entire string changes from one selected color to the next with no fade."),
        new EffectTemplate("Breath", "Brightness cycle", "The string fades up and down smoothly while stepping through the selected colors."),
        new EffectTemplate("Strobe", "Blink", "Rapid light/dark flashes using the selected color palette."),
        new EffectTemplate("Chase", "Chase", "A moving chase pattern travels along the string using the selected colors."),
        new EffectTemplate("Gradient Sweep", "Color sweep", "Selected colors blend and sweep progressively along the string."),
        new EffectTemplate("Candy Cane", "Alternating chase", "Alternating color bands travel as a repeating chase pattern."),
        new EffectTemplate("Twinkle / Sparkle", "Random blink", "Individual lamps blink or sparkle asynchronously across the string."),
        new EffectTemplate("Wipe / Fill", "Grow / fill", "One color grows across the string, then the next selected color takes over."),
        new EffectTemplate("Meteor / Comet", "Travel", "A repeating moving highlight or gap travels along the string like a comet."),
        new EffectTemplate("Rainbow Flow", "Spectrum flow", "A multi-color spectrum flows continuously along the string."),
        new EffectTemplate("Pulse Wave", "Brightness wave", "A moving color pattern rises and falls in brightness like a traveling pulse.")
    };

    // Anderson Home approved named palette, preserved exactly as its calibrated RGB values.
    static final NamedColor[] ANDERSON = {
        new NamedColor("Red",               0xFF0000, true),
        new NamedColor("Crimson",           0xDC143C, true),
        new NamedColor("Burgundy",          0x87002D, true),
        new NamedColor("Orange",            0xFF0D00, true),
        new NamedColor("True Orange",       0xFF7A00, true),
        new NamedColor("Coral",             0xFF6F61, true),
        new NamedColor("Pink",              0xFF0024, true),
        new NamedColor("Hot Pink",          0xFF4FA3, true),
        new NamedColor("Rose",              0xFF507A, true),
        new NamedColor("Magenta",           0xFF00FF, true),
        new NamedColor("Yellow",            0xE08700, true),
        new NamedColor("Amber Gold",        0xFFA000, true),
        new NamedColor("Gold",              0xFFD700, true),
        new NamedColor("Bronze",            0xCD7F32, true),
        new NamedColor("Brown",             0x8B4513, true),
        new NamedColor("Green",             0x28FF00, true),
        new NamedColor("Lime",              0x7CFF00, true),
        new NamedColor("Emerald",           0x00C875, true),
        new NamedColor("Forest Green",      0x0B6623, true),
        new NamedColor("Cyan",              0x00BD4C, true),
        new NamedColor("Teal",              0x00B4B4, true),
        new NamedColor("Turquoise",         0x40E0D0, true),
        new NamedColor("Aqua",              0x00FFFF, true),
        new NamedColor("Sky Blue",          0x0096FF, true),
        new NamedColor("Blue",              0x0D00FF, true),
        new NamedColor("Royal Blue",        0x245BFF, true),
        new NamedColor("Navy Blue",         0x001478, true),
        new NamedColor("Indigo",            0x5B00E6, true),
        new NamedColor("Purple",            0x5B00E6, true),
        new NamedColor("Deep Purple",       0x5B00E6, true),
        new NamedColor("Lavender",          0xB464FF, true),
        new NamedColor("White",             0xFFFFFA, true),
        new NamedColor("Warm White RGB",    0xFFD6A1, true),
        new NamedColor("Neutral White RGB", 0xFFF4E5, true),
        new NamedColor("Silver Gray",       0xA0A5AF, true),
        new NamedColor("Black / Off",       0x000000, true)
    };

    // Additional normal RGB quick picks. The custom RGB controls cover the rest of the 24-bit space.
    static final NamedColor[] QUICK = {
        new NamedColor("True Orange", 0xFF7A00, false),
        new NamedColor("Gold",        0xFFD700, false),
        new NamedColor("Lime",        0x7CFF00, false),
        new NamedColor("Emerald",     0x00C875, false),
        new NamedColor("Aqua",        0x00FFFF, false),
        new NamedColor("Royal Blue",  0x245BFF, false),
        new NamedColor("Indigo",      0x5B00E6, false),
        new NamedColor("Magenta",     0xFF00FF, false),
        new NamedColor("Hot Pink",    0xFF4FA3, false),
        new NamedColor("Rose",        0xFF507A, false),
        new NamedColor("Warm White RGB", 0xFFD6A1, false),
        new NamedColor("Neutral White RGB", 0xFFF4E5, false)
    };

    private LightPresetCatalog() {}
}
