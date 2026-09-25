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
        new EffectTemplate("Solid / Static", "Cycle / Solid", "One steady color or white tone."),
        new EffectTemplate("Jump", "Cycle", "Hard color-to-color changes with no fade."),
        new EffectTemplate("Breath", "Cycle + brightness", "Smooth brightness rise/fall through the selected palette."),
        new EffectTemplate("Strobe", "Blink", "Fast full-output flashes; speed adjustable."),
        new EffectTemplate("Chase", "Flow / Insert", "Moving blocks of color along the roofline."),
        new EffectTemplate("Gradient Sweep", "Flow / Gradient", "Blended colors moving through the run."),
        new EffectTemplate("Candy Cane", "Flow / Insert", "Alternating repeating color blocks; ideal red/white or custom pairs."),
        new EffectTemplate("Twinkle / Sparkle", "Twinkle / Blink", "Scattered lamps blink asynchronously."),
        new EffectTemplate("Wipe / Fill", "Flow / Fill", "Color progressively fills the run, then repeats."),
        new EffectTemplate("Meteor / Comet", "Flow / Insert", "Bright moving block with a dark gap/trail."),
        new EffectTemplate("Rainbow Flow", "Flow / Gradient", "Multi-color spectrum moving continuously."),
        new EffectTemplate("Pulse Wave", "Flow + brightness", "Moving color layer with brightness modulation.")
    };

    // Anderson Home approved named palette, preserved exactly as its calibrated RGB values.
    static final NamedColor[] ANDERSON = {
        new NamedColor("Red",        0xFF0000, true),
        new NamedColor("Orange",     0xFF0D00, true),
        new NamedColor("Pink",       0xFF0024, true),
        new NamedColor("Yellow",     0xE08700, true),
        new NamedColor("Green",      0x28FF00, true),
        new NamedColor("Cyan",       0x00BD4C, true),
        new NamedColor("Blue",       0x0D00FF, true),
        new NamedColor("Purple",     0x5B00E6, true),
        new NamedColor("White",      0xFFFFFA, true),
        new NamedColor("Teal",       0x00B4B4, true),
        new NamedColor("Sky Blue",   0x0096FF, true),
        new NamedColor("Amber Gold", 0xFFA000, true),
        new NamedColor("Lavender",   0xB464FF, true),
        new NamedColor("Navy Blue",  0x001478, true),
        new NamedColor("Burgundy",   0x87002D, true),
        new NamedColor("Silver Gray",0xA0A5AF, true)
    };

    // Additional normal RGB quick picks. The custom RGB controls cover the rest of the 24-bit space.
    static final NamedColor[] QUICK = {
        new NamedColor("True Orange", 0xFF7A00, false),
        new NamedColor("Gold",        0xFFD700, false),
        new NamedColor("Lime",        0x7CFF00, false),
        new NamedColor("Emerald",     0x00C875, false),
        new NamedColor("Aqua",        0x00FFFF, false),
        new NamedColor("Royal Blue",  0x245BFF, false),
        new NamedColor("Indigo",      0x4B0082, false),
        new NamedColor("Magenta",     0xFF00FF, false),
        new NamedColor("Hot Pink",    0xFF4FA3, false),
        new NamedColor("Rose",        0xFF507A, false),
        new NamedColor("Warm White RGB", 0xFFD6A1, false),
        new NamedColor("Neutral White RGB", 0xFFF4E5, false)
    };

    private LightPresetCatalog() {}
}
