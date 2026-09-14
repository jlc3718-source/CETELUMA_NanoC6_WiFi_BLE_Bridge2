from pathlib import Path
import re


def read(path):
    return Path(path).read_text()


def write(path, text):
    Path(path).write_text(text)

src_path = 'firmware/src/EventColorThemes.cpp'
src = read(src_path)

major_block = re.compile(
    r'// Major U\.S\. federal holiday calendar\..*?'
    r'static_assert\(sizeof\(MAJOR_US_EVENT_COLOR_INDEX\)/sizeof\(MAJOR_US_EVENT_COLOR_INDEX\[0\]\)==11,"major holiday color table"\);',
    re.S,
)
replacement = r'''// Major U.S. schedule = the complete currently-approved 28 Scene Favorites.
// The 11 federal-holiday subset keeps the nationally recognizable color choices
// introduced in v3.1.19. All additional favorites use their preserved 3.0.28
// assignments, so this schedule remains strictly on the original nine-color palette.
static constexpr uint16_t MAJOR_US_EVENT_INDEX[]={
  5,10,25,24,26,45,60,64,86,94,104,108,105,117,
  143,134,133,144,145,146,172,178,192,196,201,207,208,209
};
static constexpr uint16_t MAJOR_US_FEDERAL_EVENT_INDEX[]={5,10,25,94,105,117,143,172,192,196,207};
static constexpr uint8_t MAJOR_US_EVENT_COLOR_COUNT[]={2,3,3,3,4,3,3,3,4,3,4};
static constexpr uint8_t MAJOR_US_EVENT_COLOR_INDEX[][4]={
  {3,8,0,0}, // New Year's Day: Yellow, White
  {0,8,6,0}, // Martin Luther King Jr. Day: Red, White, Blue
  {0,8,6,0}, // Washington's Birthday: Red, White, Blue
  {0,8,6,0}, // Memorial Day: Red, White, Blue
  {0,8,6,4}, // Juneteenth: Red, White, Blue, Green
  {0,8,6,0}, // Independence Day: Red, White, Blue
  {0,8,6,0}, // Labor Day: Red, White, Blue
  {0,8,6,0}, // Columbus / Indigenous Peoples' Day: Red, White, Blue
  {0,8,6,3}, // Veterans Day: Red, White, Blue, Yellow
  {1,0,3,0}, // Thanksgiving: Orange, Red, Yellow
  {0,4,3,8}, // Christmas: Red, Green, Yellow, White
};
static_assert(sizeof(MAJOR_US_EVENT_INDEX)/sizeof(MAJOR_US_EVENT_INDEX[0])==28,"favorite holiday event count");
static_assert(sizeof(MAJOR_US_FEDERAL_EVENT_INDEX)/sizeof(MAJOR_US_FEDERAL_EVENT_INDEX[0])==11,"major federal holiday event count");
static_assert(sizeof(MAJOR_US_EVENT_COLOR_COUNT)/sizeof(MAJOR_US_EVENT_COLOR_COUNT[0])==11,"major federal holiday color count");
static_assert(sizeof(MAJOR_US_EVENT_COLOR_INDEX)/sizeof(MAJOR_US_EVENT_COLOR_INDEX[0])==11,"major federal holiday color table");'''
src2, count = major_block.subn(replacement, src, count=1)
assert count == 1, 'major holiday table block did not match exactly once'

old_func = re.compile(
    r'void applyMajorUsEventColors\(size_t index,Theme& theme\)\{\n'
    r'  for\(size_t row=0;row<sizeof\(MAJOR_US_EVENT_INDEX\)/sizeof\(MAJOR_US_EVENT_INDEX\[0\]\);row\+\+\)\{\n'
    r'    if\(MAJOR_US_EVENT_INDEX\[row\]!=index\)continue;\n'
    r'    theme\.colorCount=MAJOR_US_EVENT_COLOR_COUNT\[row\];\n'
    r'    for\(uint8_t c=0;c<theme\.colorCount;c\+\+\)theme\.colors\[c\]=resolvedPresetColor\(PRESET_DEFAULTS\[MAJOR_US_EVENT_COLOR_INDEX\[row\]\[c\]\]\);\n'
    r'    return;\n'
    r'  \}\n'
    r'\}',
    re.S,
)
new_func = '''void applyMajorUsEventColors(size_t index,Theme& theme){
  for(size_t row=0;row<sizeof(MAJOR_US_FEDERAL_EVENT_INDEX)/sizeof(MAJOR_US_FEDERAL_EVENT_INDEX[0]);row++){
    if(MAJOR_US_FEDERAL_EVENT_INDEX[row]!=index)continue;
    theme.colorCount=MAJOR_US_EVENT_COLOR_COUNT[row];
    for(uint8_t c=0;c<theme.colorCount;c++)theme.colors[c]=resolvedPresetColor(PRESET_DEFAULTS[MAJOR_US_EVENT_COLOR_INDEX[row][c]]);
    return;
  }
  if(eventColorThemeIncludesEvent(EventColorTheme::MajorUS,index))applyOriginalEventColors(index,theme);
}'''
src2, count = old_func.subn(new_func, src2, count=1)
assert count == 1, 'applyMajorUsEventColors block did not match exactly once'
write(src_path, src2)

# Update regression expectations from 11 federal-only events to the 28 current Scene Favorites.
test_path = 'tools/test_regressions.py'
test = read(test_path)
old = "assert 'MAJOR_US_EVENT_INDEX[]={5,10,25,94,105,117,143,172,192,196,207}' in original\nassert 'MAJOR_US_EVENT_COLOR_INDEX' in original and 'eventColorPresetCount(EventColorTheme theme){return theme==EventColorTheme::V3029?16U:9U;}' in original"
new = "assert 'MAJOR_US_EVENT_INDEX[]={' in original and '5,10,25,24,26,45,60,64,86,94,104,108,105,117,' in original and '143,134,133,144,145,146,172,178,192,196,201,207,208,209' in original\nassert 'MAJOR_US_FEDERAL_EVENT_INDEX[]={5,10,25,94,105,117,143,172,192,196,207}' in original\nassert 'favorite holiday event count' in original and 'applyOriginalEventColors(index,theme);' in original\nassert 'MAJOR_US_EVENT_COLOR_INDEX' in original and 'eventColorPresetCount(EventColorTheme theme){return theme==EventColorTheme::V3029?16U:9U;}' in original"
assert old in test, 'regression major holiday assertion block not found'
test = test.replace(old, new, 1)
write(test_path, test)

# Version identity must already agree before regression tests and release packaging.
Path('FIRMWARE_VERSION.txt').write_text('3.1.20\n')
main_path = 'firmware/src/main.cpp'
main = read(main_path)
assert 'ANDERSON_FIRMWARE_VERSION="3.1.19"' in main
main = main.replace('ANDERSON_FIRMWARE_VERSION="3.1.19"', 'ANDERSON_FIRMWARE_VERSION="3.1.20"', 1)
write(main_path, main)

notes = '''# Anderson Home v3.1.20

- Expands the **1 — Major U.S. Government Holidays — Basic Colors** schedule to include all 28 currently approved Scene Favorites.
- Keeps the 11 federal-holiday scenes on their dedicated nationally recognizable color combinations.
- Uses the preserved basic/original nine-color assignments for the additional favorite scenes.
- Retains the automatic-event speed cap at Slow/Very Slow.
- Breath remains selectable manually but is not assigned to any built-in automatic event.
'''
Path('firmware/RELEASE_NOTES_v3.1.20.md').write_text(notes)

print('Applied Anderson Home v3.1.20 favorite-holiday expansion')
