#include "EventColorThemes.h"
#include <ArduinoJson.h>
#include <Preferences.h>

static constexpr uint32_t ORIGINAL_COLOR_DICTIONARY[] = {
  0x00BD4C,0xFFFFFA,0x28FF00,0xFF0000,0xFF0024,0x0D00FF,0xE08700,0x5B00E6,0xFF0D00
};
static constexpr uint8_t ORIGINAL_EVENT_COLOR_INDEX[210][6] = {
  {0,1,0,0,0,0},
  {2,0,0,0,0,0},
  {3,0,0,0,0,0},
  {0,4,5,0,0,0},
  {4,5,0,0,0,0},
  {6,1,0,0,0,0},
  {6,5,0,0,0,0},
  {1,6,0,0,0,0},
  {1,6,3,0,0,0},
  {5,0,0,0,0,0},
  {3,1,5,0,0,0},
  {5,1,0,0,0,0},
  {6,5,1,0,0,0},
  {5,1,0,0,0,0},
  {3,2,6,0,0,0},
  {3,0,0,0,0,0},
  {7,0,0,0,0,0},
  {8,0,0,0,0,0},
  {3,1,5,0,0,0},
  {2,6,0,0,0,0},
  {3,0,0,0,0,0},
  {7,8,0,0,0,0},
  {7,4,0,0,0,0},
  {3,0,0,0,0,0},
  {3,4,0,0,0,0},
  {3,1,5,0,0,0},
  {7,2,6,0,0,0},
  {3,6,0,0,0,0},
  {7,0,0,0,0,0},
  {2,6,0,0,0,0},
  {5,1,0,0,0,0},
  {5,1,0,0,0,0},
  {4,5,2,7,0,0},
  {7,2,1,0,0,0},
  {5,0,0,0,0,0},
  {8,0,0,0,0,0},
  {2,0,0,0,0,0},
  {8,0,0,0,0,0},
  {8,5,0,0,0,0},
  {2,0,0,0,0,0},
  {6,0,0,0,0,0},
  {8,0,0,0,0,0},
  {1,3,0,0,0,0},
  {7,2,1,0,0,0},
  {3,0,0,0,0,0},
  {2,0,0,0,0,0},
  {2,6,0,0,0,0},
  {5,6,0,0,0,0},
  {0,5,0,0,0,0},
  {3,0,0,0,0,0},
  {7,0,0,0,0,0},
  {6,2,3,0,0,0},
  {5,4,1,0,0,0},
  {6,3,5,0,0,0},
  {0,0,0,0,0,0},
  {5,0,0,0,0,0},
  {3,0,0,0,0,0},
  {5,8,0,0,0,0},
  {1,3,0,0,0,0},
  {5,2,0,0,0,0},
  {6,7,0,0,0,0},
  {5,0,0,0,0,0},
  {5,1,0,0,0,0},
  {7,3,0,0,0,0},
  {4,6,7,1,0,0},
  {5,1,0,0,0,0},
  {3,0,0,0,0,0},
  {3,0,0,0,0,0},
  {6,5,1,0,0,0},
  {2,5,0,0,0,0},
  {8,5,0,0,0,0},
  {2,0,0,0,0,0},
  {2,0,0,0,0,0},
  {2,5,0,0,0,0},
  {7,1,0,0,0,0},
  {3,6,0,0,0,0},
  {5,1,0,0,0,0},
  {3,1,5,0,0,0},
  {8,0,0,0,0,0},
  {5,0,0,0,0,0},
  {7,0,0,0,0,0},
  {5,1,0,0,0,0},
  {1,0,0,0,0,0},
  {3,1,5,0,0,0},
  {2,1,3,0,0,0},
  {1,3,5,0,0,0},
  {4,1,0,0,0,0},
  {7,0,0,0,0,0},
  {1,5,0,0,0,0},
  {5,0,0,0,0,0},
  {3,1,5,0,0,0},
  {3,8,6,2,5,7},
  {1,3,0,0,0,0},
  {2,6,0,0,0,0},
  {3,1,5,0,0,0},
  {2,6,0,0,0,0},
  {8,0,0,0,0,0},
  {3,8,6,2,5,7},
  {7,0,0,0,0,0},
  {0,0,0,0,0,0},
  {3,6,2,5,0,0},
  {2,0,0,0,0,0},
  {3,1,5,0,0,0},
  {3,4,1,0,0,0},
  {3,1,5,0,0,0},
  {3,1,5,2,0,0},
  {3,0,0,0,0,0},
  {5,0,0,0,0,0},
  {5,1,0,0,0,0},
  {6,8,0,0,0,0},
  {0,0,0,0,0,0},
  {3,0,0,0,0,0},
  {3,6,1,5,2,0},
  {2,0,0,0,0,0},
  {6,8,0,0,0,0},
  {5,0,0,0,0,0},
  {6,0,0,0,0,0},
  {3,1,5,0,0,0},
  {3,0,0,0,0,0},
  {7,4,1,0,0,0},
  {3,1,5,0,0,0},
  {7,6,0,0,0,0},
  {6,1,0,0,0,0},
  {1,5,2,0,0,0},
  {6,2,0,0,0,0},
  {4,1,0,0,0,0},
  {8,7,0,0,0,0},
  {7,1,0,0,0,0},
  {2,5,0,0,0,0},
  {5,1,0,0,0,0},
  {5,6,0,0,0,0},
  {7,1,6,0,0,0},
  {7,1,0,0,0,0},
  {0,7,0,0,0,0},
  {6,0,0,0,0,0},
  {5,0,0,0,0,0},
  {0,0,0,0,0,0},
  {3,0,0,0,0,0},
  {3,0,0,0,0,0},
  {7,0,0,0,0,0},
  {2,6,0,0,0,0},
  {6,8,0,0,0,0},
  {4,3,0,0,0,0},
  {3,1,5,0,0,0},
  {0,7,0,0,0,0},
  {6,0,7,0,0,0},
  {3,1,5,0,0,0},
  {1,5,6,0,0,0},
  {5,6,0,0,0,0},
  {3,1,2,6,5,0},
  {3,1,5,0,0,0},
  {1,0,0,0,0,0},
  {1,0,0,0,0,0},
  {7,0,0,0,0,0},
  {1,5,0,0,0,0},
  {4,7,5,0,0,0},
  {6,5,1,0,0,0},
  {3,0,0,0,0,0},
  {4,0,0,0,0,0},
  {7,0,0,0,0,0},
  {8,0,0,0,0,0},
  {8,0,0,0,0,0},
  {5,6,0,0,0,0},
  {2,0,0,0,0,0},
  {5,1,0,0,0,0},
  {3,0,0,0,0,0},
  {5,2,0,0,0,0},
  {3,8,6,2,5,7},
  {5,3,1,6,0,0},
  {4,5,0,0,0,0},
  {2,0,0,0,0,0},
  {5,6,0,0,0,0},
  {3,6,1,0,0,0},
  {1,3,0,0,0,0},
  {4,5,0,0,0,0},
  {7,0,0,0,0,0},
  {6,8,3,0,0,0},
  {5,7,0,0,0,0},
  {8,7,0,0,0,0},
  {3,6,1,5,0,0},
  {5,0,0,0,0,0},
  {8,0,0,0,0,0},
  {1,0,0,0,0,0},
  {7,0,0,0,0,0},
  {7,0,0,0,0,0},
  {7,0,0,0,0,0},
  {7,0,0,0,0,0},
  {2,0,0,0,0,0},
  {1,6,0,0,0,0},
  {7,1,0,0,0,0},
  {3,1,5,0,0,0},
  {6,3,8,0,0,0},
  {3,1,5,6,0,0},
  {5,0,0,0,0,0},
  {7,0,0,0,0,0},
  {5,4,1,0,0,0},
  {8,3,6,0,0,0},
  {3,6,1,0,0,0},
  {3,0,0,0,0,0},
  {3,0,0,0,0,0},
  {7,5,0,0,0,0},
  {5,1,0,0,0,0},
  {3,1,5,0,0,0},
  {5,1,0,0,0,0},
  {3,1,5,0,0,0},
  {1,0,5,0,0,0},
  {3,2,6,0,0,0},
  {3,2,6,1,0,0},
  {3,2,0,0,0,0},
  {6,1,7,0,0,0}
};
static constexpr uint8_t ORIGINAL_EVENT_COLOR_COUNT[210] = {
  2,1,1,3,2,2,2,2,3,1,3,2,3,2,3,1,1,1,3,2,1,2,2,1,2,3,3,2,1,2,2,2,4,3,1,1,1,1,2,1,1,1,2,3,1,1,2,2,2,1,1,3,3,3,1,1,1,2,2,2,2,1,2,2,4,2,1,1,3,2,2,1,1,2,2,2,2,3,1,1,1,2,1,3,3,3,2,1,2,1,3,6,2,2,3,2,1,6,1,1,4,1,3,3,3,4,1,1,2,2,1,1,5,1,2,1,1,3,1,3,3,2,2,3,2,2,2,2,2,2,2,3,2,2,1,1,1,1,1,1,2,2,2,3,2,3,3,3,2,5,3,1,1,1,2,3,3,1,1,1,1,1,2,1,2,1,2,6,4,2,1,2,3,2,2,1,3,2,2,4,1,1,1,1,1,1,1,1,2,2,3,3,4,1,1,3,3,3,1,1,2,2,3,2,3,3,3,4,2,3
};

static constexpr const char* PRESET_NAMES[]={
  "Red","Orange","Pink","Yellow","Green","Cyan","Blue","Purple","White",
  "Teal","Sky Blue","Amber Gold","Lavender","Navy Blue","Burgundy","Silver Gray"
};
static constexpr uint32_t PRESET_DEFAULTS[]={
  0xFF0000,0xFF0D00,0xFF0024,0xE08700,0x28FF00,0x00BD4C,0x0D00FF,0x5B00E6,0xFFFFFA,
  0x00B4B4,0x0096FF,0xFFA000,0xB464FF,0x001478,0x87002D,0xA0A5AF
};
static_assert(sizeof(PRESET_NAMES)/sizeof(PRESET_NAMES[0])==16,"preset name count");
static_assert(sizeof(PRESET_DEFAULTS)/sizeof(PRESET_DEFAULTS[0])==16,"preset value count");

// Major U.S. federal holiday calendar. Indices are zero-based EventCatalog rows:
// New Year, MLK, Washington's Birthday, Memorial Day, Juneteenth, Independence
// Day, Labor Day, Columbus/Indigenous Peoples' Day, Veterans Day, Thanksgiving,
// and Christmas. Every color index references only the original nine presets.
static constexpr uint16_t MAJOR_US_EVENT_INDEX[]={5,10,25,94,105,117,143,172,192,196,207};
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
static_assert(sizeof(MAJOR_US_EVENT_INDEX)/sizeof(MAJOR_US_EVENT_INDEX[0])==11,"major holiday event count");
static_assert(sizeof(MAJOR_US_EVENT_COLOR_COUNT)/sizeof(MAJOR_US_EVENT_COLOR_COUNT[0])==11,"major holiday color count");
static_assert(sizeof(MAJOR_US_EVENT_COLOR_INDEX)/sizeof(MAJOR_US_EVENT_COLOR_INDEX[0])==11,"major holiday color table");
static uint32_t presetValues[16]={0};
static bool presetLoaded=false;

static int presetIndexForDefault(uint32_t c){
  c&=0xFFFFFF;
  if(c==0xFFFF44||c==0xE0B400||c==0xE08700)return 3;
  for(size_t i=0;i<16;i++)if(PRESET_DEFAULTS[i]==c)return (int)i;
  return -1;
}
static uint32_t resolvedPresetColor(uint32_t c){
  if(!presetLoaded)loadEventColorPresetOverrides();
  int i=presetIndexForDefault(c);return i>=0?presetValues[i]:(c&0xFFFFFF);
}
const char* eventColorThemeName(EventColorTheme theme){
  if(theme==EventColorTheme::MajorUS)return "Major U.S. Government Holidays - Basic Colors";
  if(theme==EventColorTheme::V3028)return "Expanded Holidays - Basic Colors";
  return "Expanded Holidays - Expanded Colors";
}
const char* eventColorThemeId(EventColorTheme theme){return theme==EventColorTheme::MajorUS?"1":(theme==EventColorTheme::V3028?"3.0.28":"3.0.29");}
size_t eventColorPresetCount(EventColorTheme theme){return theme==EventColorTheme::V3029?16U:9U;}
bool eventColorThemeIncludesEvent(EventColorTheme theme,size_t index){
  if(theme!=EventColorTheme::MajorUS)return true;
  for(size_t i=0;i<sizeof(MAJOR_US_EVENT_INDEX)/sizeof(MAJOR_US_EVENT_INDEX[0]);i++)if(MAJOR_US_EVENT_INDEX[i]==index)return true;
  return false;
}
void applyMajorUsEventColors(size_t index,Theme& theme){
  for(size_t row=0;row<sizeof(MAJOR_US_EVENT_INDEX)/sizeof(MAJOR_US_EVENT_INDEX[0]);row++){
    if(MAJOR_US_EVENT_INDEX[row]!=index)continue;
    theme.colorCount=MAJOR_US_EVENT_COLOR_COUNT[row];
    for(uint8_t c=0;c<theme.colorCount;c++)theme.colors[c]=resolvedPresetColor(PRESET_DEFAULTS[MAJOR_US_EVENT_COLOR_INDEX[row][c]]);
    return;
  }
}
const char* eventColorPresetName(size_t index){return index<16?PRESET_NAMES[index]:"";}
uint32_t eventColorPresetDefault(size_t index){return index<16?PRESET_DEFAULTS[index]:0;}
uint32_t eventColorPresetValue(size_t index){if(!presetLoaded)loadEventColorPresetOverrides();return index<16?presetValues[index]:0;}

void loadEventColorPresetOverrides(){
  for(size_t i=0;i<16;i++)presetValues[i]=PRESET_DEFAULTS[i];
  Preferences p;if(!p.begin("anderson-colors",true)){presetLoaded=true;return;}
  String raw=p.getString("saved","");p.end();JsonDocument d;
  if(raw.length()&&!deserializeJson(d,raw)&&d.is<JsonArray>()&&d.as<JsonArray>().size()==16){
    size_t i=0;for(JsonVariant v:d.as<JsonArray>()){String s=v.as<String>();s.trim();if(s.startsWith("#"))s.remove(0,1);
      if(s.length()==6){char* end=nullptr;unsigned long c=strtoul(s.c_str(),&end,16);if(end&&*end=='\0')presetValues[i]=(uint32_t)c&0xFFFFFF;}i++;}
  }
  presetLoaded=true;
}
bool saveEventColorPreset(size_t index,uint32_t color){
  if(index>=16)return false;if(!presetLoaded)loadEventColorPresetOverrides();uint32_t old=presetValues[index];presetValues[index]=color&0xFFFFFF;
  JsonDocument d;JsonArray a=d.to<JsonArray>();char h[8];for(size_t i=0;i<16;i++){snprintf(h,sizeof(h),"#%06lX",(unsigned long)presetValues[i]);a.add(h);}
  String raw;serializeJson(d,raw);Preferences p;if(!p.begin("anderson-colors",false)){presetValues[index]=old;return false;}
  size_t wrote=p.putString("saved",raw);String verify=p.getString("saved","");p.end();if(wrote!=raw.length()||verify!=raw){presetValues[index]=old;return false;}return true;
}
void applyOriginalEventColors(size_t index,Theme& theme){
  if(index>=210)return;uint8_t count=ORIGINAL_EVENT_COLOR_COUNT[index];theme.colorCount=count;
  for(uint8_t i=0;i<count;i++)theme.colors[i]=resolvedPresetColor(ORIGINAL_COLOR_DICTIONARY[ORIGINAL_EVENT_COLOR_INDEX[index][i]]);
}
void applyModernEventColors(Theme& theme){for(uint8_t i=0;i<theme.colorCount;i++)theme.colors[i]=resolvedPresetColor(theme.colors[i]);}
