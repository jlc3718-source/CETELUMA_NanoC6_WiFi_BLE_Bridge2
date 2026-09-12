#include "EventCatalog.h"

#define C1(a) {a,0,0,0,0,0}
#define C2(a,b) {a,b,0,0,0,0}
#define C3(a,b,c) {a,b,c,0,0,0}
#define C4(a,b,c,d) {a,b,c,d,0,0}
#define C5(a,b,c,d,e) {a,b,c,d,e,0}
#define C6(a,b,c,d,e,f) {a,b,c,d,e,f}

const EventDef EVENTS[] = {
{"evt001","Cervical Cancer Awareness Month",EventKind::Awareness,RuleType::Month,1,0,0,0,0,1,Effect::Breath,C2(0x00B4B4,0xFFFFFA),2 },
{"evt002","Glaucoma Awareness Month",EventKind::Awareness,RuleType::Month,1,0,0,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt003","National Blood Donor Month",EventKind::Awareness,RuleType::Month,1,0,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt004","Thyroid Awareness Month",EventKind::Awareness,RuleType::Month,1,0,0,0,0,1,Effect::Breath,C3(0x00B4B4,0xFF0024,0x0096FF),3 },
{"evt005","Birth Defects Awareness Month",EventKind::Awareness,RuleType::Month,1,0,0,0,0,1,Effect::Breath,C2(0xFF0024,0x0096FF),2 },
{"evt006","New Year's Day",EventKind::Holiday,RuleType::Fixed,1,1,0,0,0,1,Effect::Jump,C2(0xFFA000,0xFFFFFA),2 },
{"evt007","World Braille Day",EventKind::Awareness,RuleType::Fixed,1,4,0,0,0,1,Effect::Breath,C2(0xFFFF44,0x0096FF),2 },
{"evt008","Epiphany",EventKind::Holiday,RuleType::Fixed,1,6,0,0,0,1,Effect::Breath,C2(0xFFFFFA,0xFFA000),2 },
{"evt009","Orthodox Christmas",EventKind::Holiday,RuleType::Fixed,1,7,0,0,0,1,Effect::Breath,C3(0xFFFFFA,0xFFA000,0xFF0000),3 },
{"evt010","National Human Trafficking Awareness Day",EventKind::Awareness,RuleType::Fixed,1,11,0,0,0,1,Effect::Breath,C1(0x0D00FF),1 },
{"evt011","Martin Luther King Jr. Day",EventKind::Holiday,RuleType::NthWeekday,1,0,1,3,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt012","International Day of Education",EventKind::Awareness,RuleType::Fixed,1,24,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFFFFFA),2 },
{"evt013","International Holocaust Remembrance Day",EventKind::Holiday,RuleType::Fixed,1,27,0,0,0,1,Effect::Breath,C3(0xFFFF44,0x0D00FF,0xFFFFFA),3 },
{"evt014","Data Privacy Day",EventKind::Awareness,RuleType::Fixed,1,28,0,0,0,1,Effect::Breath,C2(0x0D00FF,0xFFFFFA),2 },
{"evt015","Black History Month",EventKind::Awareness,RuleType::Month,2,0,0,0,0,1,Effect::Breath,C3(0xFF0000,0x28FF00,0xFFA000),3 },
{"evt016","American Heart Month",EventKind::Awareness,RuleType::Month,2,0,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt017","National Cancer Prevention Month",EventKind::Awareness,RuleType::Month,2,0,0,0,0,1,Effect::Breath,C1(0xB464FF),1 },
{"evt018","Teen Dating Violence Awareness Month",EventKind::Awareness,RuleType::Month,2,0,0,0,0,1,Effect::Breath,C1(0xFF0D00),1 },
{"evt019","National Freedom Day",EventKind::Awareness,RuleType::Fixed,2,1,0,0,0,1,Effect::Breath,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt020","Groundhog Day",EventKind::Seasonal,RuleType::Fixed,2,2,0,0,0,1,Effect::Breath,C2(0x28FF00,0xFFA000),2 },
{"evt021","National Wear Red Day",EventKind::Awareness,RuleType::NthWeekday,2,0,5,1,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt022","World Cancer Day",EventKind::Awareness,RuleType::Fixed,2,4,0,0,0,1,Effect::Breath,C2(0xB464FF,0xFF0D00),2 },
{"evt023","National Girls & Women in Sports Day",EventKind::Awareness,RuleType::Fixed,2,4,0,0,0,1,Effect::Breath,C2(0x5B00E6,0xFF0024),2 },
{"evt024","National Black HIV/AIDS Awareness Day",EventKind::Awareness,RuleType::Fixed,2,7,0,0,0,1,Effect::Breath,C2(0xFF0000,0x87002D),2 },
{"evt025","Valentine's Day",EventKind::Holiday,RuleType::Fixed,2,14,0,0,0,1,Effect::Jump,C2(0xFF0000,0xFF0024),2 },
{"evt026","Presidents' Day / Washington's Birthday",EventKind::Holiday,RuleType::NthWeekday,2,0,1,3,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt027","Mardi Gras / Shrove Tuesday",EventKind::Holiday,RuleType::EasterOffset,0,0,0,0,-47,1,Effect::Jump,C3(0x5B00E6,0x28FF00,0xFFA000),3 },
{"evt028","Lunar New Year",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,15,Effect::Jump,C2(0xFF0000,0xFFA000),2 },
{"evt029","Ash Wednesday",EventKind::Holiday,RuleType::EasterOffset,0,0,0,0,-46,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt030","Ramadan",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,30,Effect::Breath,C2(0x28FF00,0xFFA000),2 },
{"evt031","World Day of Social Justice",EventKind::Awareness,RuleType::Fixed,2,20,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFFFFFA),2 },
{"evt032","International Mother Language Day",EventKind::Awareness,RuleType::Fixed,2,21,0,0,0,1,Effect::Breath,C2(0x0D00FF,0xFFFFFA),2 },
{"evt033","Rare Disease Day",EventKind::Awareness,RuleType::MonthEnd,2,0,0,0,0,1,Effect::Breath,C4(0xFF0024,0x0096FF,0x28FF00,0x5B00E6),4 },
{"evt034","Women's History Month",EventKind::Awareness,RuleType::Month,3,0,0,0,0,1,Effect::Breath,C3(0x5B00E6,0x28FF00,0xFFFFFA),3 },
{"evt035","National Colorectal Cancer Awareness Month",EventKind::Awareness,RuleType::Month,3,0,0,0,0,1,Effect::Breath,C1(0x001478),1 },
{"evt036","National Kidney Month",EventKind::Awareness,RuleType::Month,3,0,0,0,0,1,Effect::Breath,C1(0xFF0D00),1 },
{"evt037","National Nutrition Month",EventKind::Awareness,RuleType::Month,3,0,0,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt038","Multiple Sclerosis Awareness Month",EventKind::Awareness,RuleType::Month,3,0,0,0,0,1,Effect::Breath,C1(0xFF0D00),1 },
{"evt039","Developmental Disabilities Awareness Month",EventKind::Awareness,RuleType::Month,3,0,0,0,0,1,Effect::Breath,C2(0xFF0D00,0x0D00FF),2 },
{"evt040","Brain Injury Awareness Month",EventKind::Awareness,RuleType::Month,3,0,0,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt041","Endometriosis Awareness Month",EventKind::Awareness,RuleType::Month,3,0,0,0,0,1,Effect::Breath,C1(0xFFFF44),1 },
{"evt042","Self-Injury Awareness Day",EventKind::Awareness,RuleType::Fixed,3,1,0,0,0,1,Effect::Breath,C1(0xFF0D00),1 },
{"evt043","World Hearing Day",EventKind::Awareness,RuleType::Fixed,3,3,0,0,0,1,Effect::Breath,C2(0xA0A5AF,0xFF0000),2 },
{"evt044","International Women's Day",EventKind::Awareness,RuleType::Fixed,3,8,0,0,0,1,Effect::Breath,C3(0x5B00E6,0x28FF00,0xFFFFFA),3 },
{"evt045","National Women and Girls HIV/AIDS Awareness Day",EventKind::Awareness,RuleType::Fixed,3,10,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt046","St. Patrick's Day",EventKind::Holiday,RuleType::Fixed,3,17,0,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt047","Eid al-Fitr",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,1,Effect::Breath,C2(0x28FF00,0xFFA000),2 },
{"evt048","World Down Syndrome Day",EventKind::Awareness,RuleType::Fixed,3,21,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFFFF44),2 },
{"evt049","World Water Day",EventKind::Awareness,RuleType::Fixed,3,22,0,0,0,1,Effect::Breath,C2(0x0096FF,0x00B4B4),2 },
{"evt050","World Tuberculosis Day",EventKind::Awareness,RuleType::Fixed,3,24,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt051","Purple Day / Epilepsy Awareness",EventKind::Awareness,RuleType::Fixed,3,26,0,0,0,1,Effect::Breath,C2(0xB464FF,0x5B00E6),2 },
{"evt052","National Vietnam War Veterans Day",EventKind::Holiday,RuleType::Fixed,3,29,0,0,0,1,Effect::Breath,C3(0xFFA000,0x28FF00,0xFF0000),3 },
{"evt053","International Transgender Day of Visibility",EventKind::Awareness,RuleType::Fixed,3,31,0,0,0,1,Effect::Breath,C3(0x0096FF,0xFF0024,0xFFFFFA),3 },
{"evt054","Autism Acceptance Month",EventKind::Awareness,RuleType::Month,4,0,0,0,0,1,Effect::Breath,C3(0xFFA000,0xFF0000,0x0096FF),3 },
{"evt055","Sexual Assault Awareness Month",EventKind::Awareness,RuleType::Month,4,0,0,0,0,1,Effect::Breath,C1(0x00B4B4),1 },
{"evt056","Child Abuse Prevention Month",EventKind::Awareness,RuleType::Month,4,0,0,0,0,1,Effect::Breath,C1(0x001478),1 },
{"evt057","Alcohol Awareness Month",EventKind::Awareness,RuleType::Month,4,0,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt058","National Minority Health Month",EventKind::Awareness,RuleType::Month,4,0,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFF0D00),2 },
{"evt059","Parkinson's Awareness Month",EventKind::Awareness,RuleType::Month,4,0,0,0,0,1,Effect::Breath,C2(0xA0A5AF,0xFF0000),2 },
{"evt060","Donate Life Month",EventKind::Awareness,RuleType::Month,4,0,0,0,0,1,Effect::Breath,C2(0x0096FF,0x28FF00),2 },
{"evt061","April Fools' Day",EventKind::Holiday,RuleType::Fixed,4,1,0,0,0,1,Effect::Jump,C2(0xFFFF44,0x5B00E6),2 },
{"evt062","World Autism Awareness Day",EventKind::Awareness,RuleType::Fixed,4,2,0,0,0,1,Effect::Breath,C1(0x0096FF),1 },
{"evt063","Passover",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,8,Effect::Breath,C2(0x0096FF,0xFFFFFA),2 },
{"evt064","Good Friday",EventKind::Holiday,RuleType::EasterOffset,0,0,0,0,-2,1,Effect::Breath,C2(0x5B00E6,0xFF0000),2 },
{"evt065","Easter Sunday",EventKind::Holiday,RuleType::EasterOffset,0,0,0,0,0,1,Effect::Jump,C4(0xFF0024,0xFFFF44,0xB464FF,0xFFFFFA),4 },
{"evt066","World Health Day",EventKind::Awareness,RuleType::Fixed,4,7,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFFFFFA),2 },
{"evt067","National Youth HIV/AIDS Awareness Day",EventKind::Awareness,RuleType::Fixed,4,10,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt068","World Parkinson's Day",EventKind::Awareness,RuleType::Fixed,4,11,0,0,0,1,Effect::Breath,C2(0xFF0000,0xA0A5AF),2 },
{"evt069","Yom HaShoah / Holocaust Remembrance Day",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,1,Effect::Breath,C3(0xFFFF44,0x0096FF,0xFFFFFA),3 },
{"evt070","Earth Day",EventKind::Seasonal,RuleType::Fixed,4,22,0,0,0,1,Effect::Breath,C2(0x28FF00,0x0096FF),2 },
{"evt071","World Malaria Day",EventKind::Awareness,RuleType::Fixed,4,25,0,0,0,1,Effect::Breath,C2(0xFF0D00,0x0096FF),2 },
{"evt072","Arbor Day",EventKind::Seasonal,RuleType::LastWeekday,4,0,5,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt073","Mental Health Awareness Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt074","National Physical Fitness & Sports Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C2(0x28FF00,0x0096FF),2 },
{"evt075","Older Americans Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C2(0x5B00E6,0xA0A5AF),2 },
{"evt076","Asian American, Native Hawaiian & Pacific Islander Heritage Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C2(0xFF0000,0xFFA000),2 },
{"evt077","Jewish American Heritage Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C2(0x0D00FF,0xFFFFFA),2 },
{"evt078","Military Appreciation Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt079","Skin Cancer Awareness Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C1(0xFF0D00),1 },
{"evt080","Arthritis Awareness Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C1(0x0096FF),1 },
{"evt081","Lupus Awareness Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt082","ALS Awareness Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C2(0x001478,0xFFFFFA),2 },
{"evt083","Brain Tumor Awareness Month",EventKind::Awareness,RuleType::Month,5,0,0,0,0,1,Effect::Breath,C1(0xA0A5AF),1 },
{"evt084","Law Day",EventKind::Awareness,RuleType::Fixed,5,1,0,0,0,1,Effect::Breath,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt085","Cinco de Mayo",EventKind::Holiday,RuleType::Fixed,5,5,0,0,0,1,Effect::Jump,C3(0x28FF00,0xFFFFFA,0xFF0000),3 },
{"evt086","National Nurses Day",EventKind::Awareness,RuleType::Fixed,5,6,0,0,0,1,Effect::Breath,C3(0xFFFFFA,0xFF0000,0x0096FF),3 },
{"evt087","Mother's Day",EventKind::Holiday,RuleType::NthWeekday,5,0,0,2,0,1,Effect::Breath,C2(0xFF0024,0xFFFFFA),2 },
{"evt088","World Lupus Day",EventKind::Awareness,RuleType::Fixed,5,10,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt089","International Nurses Day",EventKind::Awareness,RuleType::Fixed,5,12,0,0,0,1,Effect::Breath,C2(0xFFFFFA,0x0096FF),2 },
{"evt090","Peace Officers Memorial Day",EventKind::Holiday,RuleType::Fixed,5,15,0,0,0,1,Effect::Solid,C1(0x001478),1 },
{"evt091","Armed Forces Day",EventKind::Holiday,RuleType::NthWeekday,5,0,6,3,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt092","International Day Against Homophobia, Biphobia & Transphobia",EventKind::Awareness,RuleType::Fixed,5,17,0,0,0,1,Effect::Breath,C6(0xFF0000,0xFF0D00,0xFFFF44,0x28FF00,0x0096FF,0x5B00E6),6 },
{"evt093","HIV Vaccine Awareness Day",EventKind::Awareness,RuleType::Fixed,5,18,0,0,0,1,Effect::Breath,C2(0xFFFFFA,0xFF0000),2 },
{"evt094","National Missing Children's Day",EventKind::Awareness,RuleType::Fixed,5,25,0,0,0,1,Effect::Breath,C2(0x28FF00,0xFFA000),2 },
{"evt095","Memorial Day",EventKind::Holiday,RuleType::LastWeekday,5,0,1,0,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt096","Eid al-Adha",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,1,Effect::Breath,C2(0x28FF00,0xFFA000),2 },
{"evt097","World MS Day",EventKind::Awareness,RuleType::Fixed,5,30,0,0,0,1,Effect::Breath,C1(0xFF0D00),1 },
{"evt098","Pride Month",EventKind::Awareness,RuleType::Month,6,0,0,0,0,1,Effect::Breath,C6(0xFF0000,0xFF0D00,0xFFFF44,0x28FF00,0x0096FF,0x5B00E6),6 },
{"evt099","Alzheimer's & Brain Awareness Month",EventKind::Awareness,RuleType::Month,6,0,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt100","PTSD Awareness Month",EventKind::Awareness,RuleType::Month,6,0,0,0,0,1,Effect::Breath,C1(0x00B4B4),1 },
{"evt101","Caribbean-American Heritage Month",EventKind::Awareness,RuleType::Month,6,0,0,0,0,1,Effect::Breath,C4(0xFF0000,0xFFA000,0x28FF00,0x0096FF),4 },
{"evt102","National Safety Month",EventKind::Awareness,RuleType::Month,6,0,0,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt103","D-Day Remembrance",EventKind::Holiday,RuleType::Fixed,6,6,0,0,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt104","Loving Day",EventKind::Awareness,RuleType::Fixed,6,12,0,0,0,1,Effect::Breath,C3(0xFF0000,0xFF0024,0xFFFFFA),3 },
{"evt105","Flag Day",EventKind::Holiday,RuleType::Fixed,6,14,0,0,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt106","Juneteenth",EventKind::Holiday,RuleType::Fixed,6,19,0,0,0,1,Effect::Jump,C4(0xFF0000,0xFFFFFA,0x0D00FF,0x28FF00),4 },
{"evt107","World Sickle Cell Day",EventKind::Awareness,RuleType::Fixed,6,19,0,0,0,1,Effect::Breath,C1(0x87002D),1 },
{"evt108","World Refugee Day",EventKind::Awareness,RuleType::Fixed,6,20,0,0,0,1,Effect::Breath,C1(0x0096FF),1 },
{"evt109","Father's Day",EventKind::Holiday,RuleType::NthWeekday,6,0,0,3,0,1,Effect::Breath,C2(0x001478,0xFFFFFA),2 },
{"evt110","International Day of Yoga / Summer Solstice",EventKind::Awareness,RuleType::Fixed,6,21,0,0,0,1,Effect::Breath,C2(0xFFFF44,0xFF0D00),2 },
{"evt111","PTSD Awareness Day",EventKind::Awareness,RuleType::Fixed,6,27,0,0,0,1,Effect::Breath,C1(0x00B4B4),1 },
{"evt112","National HIV Testing Day",EventKind::Awareness,RuleType::Fixed,6,27,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt113","Disability Pride Month",EventKind::Awareness,RuleType::Month,7,0,0,0,0,1,Effect::Breath,C5(0xFF0000,0xFFA000,0xFFFFFA,0x0096FF,0x28FF00),5 },
{"evt114","National Minority Mental Health Awareness Month",EventKind::Awareness,RuleType::Month,7,0,0,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt115","UV Safety Awareness Month",EventKind::Awareness,RuleType::Month,7,0,0,0,0,1,Effect::Breath,C2(0xFFFF44,0xFF0D00),2 },
{"evt116","Juvenile Arthritis Awareness Month",EventKind::Awareness,RuleType::Month,7,0,0,0,0,1,Effect::Breath,C1(0x0096FF),1 },
{"evt117","Sarcoma Awareness Month",EventKind::Awareness,RuleType::Month,7,0,0,0,0,1,Effect::Breath,C1(0xFFFF44),1 },
{"evt118","Independence Day",EventKind::Holiday,RuleType::Fixed,7,4,0,0,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt119","Zero HIV Stigma Day",EventKind::Awareness,RuleType::Fixed,7,21,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt120","Parents' Day",EventKind::Holiday,RuleType::NthWeekday,7,0,0,4,0,1,Effect::Breath,C3(0x5B00E6,0xFF0024,0xFFFFFA),3 },
{"evt121","National Korean War Veterans Armistice Day",EventKind::Holiday,RuleType::Fixed,7,27,0,0,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt122","World Hepatitis Day",EventKind::Awareness,RuleType::Fixed,7,28,0,0,0,1,Effect::Breath,C2(0x5B00E6,0xFFFF44),2 },
{"evt123","National Breastfeeding Month",EventKind::Awareness,RuleType::Month,8,0,0,0,0,1,Effect::Breath,C2(0xFFA000,0xFFFFFA),2 },
{"evt124","National Immunization Awareness Month",EventKind::Awareness,RuleType::Month,8,0,0,0,0,1,Effect::Breath,C3(0xFFFFFA,0x0096FF,0x28FF00),3 },
{"evt125","Children's Eye Health & Safety Month",EventKind::Awareness,RuleType::Month,8,0,0,0,0,1,Effect::Breath,C2(0xFFA000,0x28FF00),2 },
{"evt126","Spinal Muscular Atrophy Awareness Month",EventKind::Awareness,RuleType::Month,8,0,0,0,0,1,Effect::Breath,C2(0xFF0024,0xFFFFFA),2 },
{"evt127","Psoriasis Awareness Month",EventKind::Awareness,RuleType::Month,8,0,0,0,0,1,Effect::Breath,C2(0xFF0D00,0xB464FF),2 },
{"evt128","Purple Heart Day",EventKind::Holiday,RuleType::Fixed,8,7,0,0,0,1,Effect::Breath,C2(0x5B00E6,0xFFFFFA),2 },
{"evt129","International Youth Day",EventKind::Awareness,RuleType::Fixed,8,12,0,0,0,1,Effect::Breath,C2(0x28FF00,0x0096FF),2 },
{"evt130","National Aviation Day",EventKind::Awareness,RuleType::Fixed,8,19,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFFFFFA),2 },
{"evt131","World Humanitarian Day",EventKind::Awareness,RuleType::Fixed,8,19,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFFA000),2 },
{"evt132","Women's Equality Day",EventKind::Awareness,RuleType::Fixed,8,26,0,0,0,1,Effect::Breath,C3(0x5B00E6,0xFFFFFA,0xFFA000),3 },
{"evt133","International Overdose Awareness Day",EventKind::Awareness,RuleType::Fixed,8,31,0,0,0,1,Effect::Breath,C2(0x5B00E6,0xA0A5AF),2 },
{"evt134","Suicide Prevention Awareness Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Breath,C2(0x00B4B4,0x5B00E6),2 },
{"evt135","Childhood Cancer Awareness Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Breath,C1(0xFFA000),1 },
{"evt136","Prostate Cancer Awareness Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Breath,C1(0x0096FF),1 },
{"evt137","Ovarian Cancer Awareness Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Breath,C1(0x00B4B4),1 },
{"evt138","Blood Cancer Awareness Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt139","Sickle Cell Awareness Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Breath,C1(0x87002D),1 },
{"evt140","National Recovery Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt141","Healthy Aging Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Breath,C2(0x28FF00,0xFFA000),2 },
{"evt142","Childhood Obesity Awareness Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Breath,C2(0xFFFF44,0xFF0D00),2 },
{"evt143","Sepsis Awareness Month",EventKind::Awareness,RuleType::Month,9,0,0,0,0,1,Effect::Breath,C2(0xFF0024,0xFF0000),2 },
{"evt144","Labor Day",EventKind::Holiday,RuleType::NthWeekday,9,0,1,1,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt145","988 Day",EventKind::Awareness,RuleType::Fixed,9,8,0,0,0,1,Effect::Breath,C2(0x00B4B4,0x5B00E6),2 },
{"evt146","World Suicide Prevention Day",EventKind::Awareness,RuleType::Fixed,9,10,0,0,0,1,Effect::Breath,C3(0xFFFF44,0x00B4B4,0x5B00E6),3 },
{"evt147","Patriot Day / 9-11 Remembrance",EventKind::Holiday,RuleType::Fixed,9,11,0,0,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt148","Rosh Hashanah",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,2,Effect::Breath,C3(0xFFFFFA,0x0096FF,0xFFA000),3 },
{"evt149","Grandparents Day",EventKind::Holiday,RuleType::NthWeekday,9,0,1,1,6,1,Effect::Breath,C2(0x0096FF,0xFFFF44),2 },
{"evt150","Hispanic Heritage Month",EventKind::Awareness,RuleType::Fixed,9,15,0,0,0,31,Effect::Breath,C5(0xFF0000,0xFFFFFA,0x28FF00,0xFFA000,0x0096FF),5 },
{"evt151","Constitution Day & Citizenship Day",EventKind::Awareness,RuleType::Fixed,9,17,0,0,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt152","National POW/MIA Recognition Day",EventKind::Holiday,RuleType::NthWeekday,9,0,5,3,0,1,Effect::Solid,C2(0xA0A5AF,0xFFFFFA),2 },
{"evt153","Yom Kippur",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,1,Effect::Solid,C1(0xFFFFFA),1 },
{"evt154","World Alzheimer's Day",EventKind::Awareness,RuleType::Fixed,9,21,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt155","International Day of Peace",EventKind::Awareness,RuleType::Fixed,9,21,0,0,0,1,Effect::Breath,C2(0xFFFFFA,0x0096FF),2 },
{"evt156","Celebrate Bisexuality Day",EventKind::Awareness,RuleType::Fixed,9,23,0,0,0,1,Effect::Breath,C3(0xFF0024,0x5B00E6,0x0096FF),3 },
{"evt157","Gold Star Mother's & Family Day",EventKind::Holiday,RuleType::LastWeekday,9,0,0,0,0,1,Effect::Breath,C3(0xFFA000,0x001478,0xFFFFFA),3 },
{"evt158","World Heart Day",EventKind::Awareness,RuleType::Fixed,9,29,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt159","Breast Cancer Awareness Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C1(0xFF0024),1 },
{"evt160","Domestic Violence Awareness Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt161","ADHD Awareness Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C1(0xFF0D00),1 },
{"evt162","National Bullying Prevention Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C1(0xFF0D00),1 },
{"evt163","Down Syndrome Awareness Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFFFF44),2 },
{"evt164","Liver Cancer Awareness Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt165","Health Literacy Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFFFFFA),2 },
{"evt166","Substance Use Prevention Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt167","Cybersecurity Awareness Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C2(0x0096FF,0x28FF00),2 },
{"evt168","LGBTQ+ History Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C6(0xFF0000,0xFF0D00,0xFFFF44,0x28FF00,0x0096FF,0x5B00E6),6 },
{"evt169","Filipino American History Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C4(0x0096FF,0xFF0000,0xFFFFFA,0xFFA000),4 },
{"evt170","Pregnancy & Infant Loss Awareness Month",EventKind::Awareness,RuleType::Month,10,0,0,0,0,1,Effect::Breath,C2(0xFF0024,0x0096FF),2 },
{"evt171","World Mental Health Day",EventKind::Awareness,RuleType::Fixed,10,10,0,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt172","National Coming Out Day",EventKind::Awareness,RuleType::Fixed,10,11,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFFFF44),2 },
{"evt173","Indigenous Peoples' Day / Columbus Day",EventKind::Holiday,RuleType::NthWeekday,10,0,1,2,0,1,Effect::Jump,C3(0xFF0000,0xFFA000,0xFFFFFA),3 },
{"evt174","White Cane Safety Day",EventKind::Awareness,RuleType::Fixed,10,15,0,0,0,1,Effect::Breath,C2(0xFFFFFA,0xFF0000),2 },
{"evt175","Pregnancy & Infant Loss Remembrance Day",EventKind::Awareness,RuleType::Fixed,10,15,0,0,0,1,Effect::Breath,C2(0xFF0024,0x0096FF),2 },
{"evt176","Spirit Day",EventKind::Awareness,RuleType::NthWeekday,10,0,4,3,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt177","Dussehra",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,1,Effect::Breath,C3(0xFFA000,0xFF0D00,0xFF0000),3 },
{"evt178","World Stroke Day",EventKind::Awareness,RuleType::Fixed,10,29,0,0,0,1,Effect::Breath,C2(0x0096FF,0x5B00E6),2 },
{"evt179","Halloween",EventKind::Seasonal,RuleType::Fixed,10,31,0,0,0,1,Effect::Strobe,C3(0xFF0D00,0x5B00E6,0x28FF00),3 },
{"evt180","Native American Heritage Month",EventKind::Awareness,RuleType::Month,11,0,0,0,0,1,Effect::Breath,C4(0xFF0000,0xFFA000,0xFFFFFA,0x0096FF),4 },
{"evt181","National Diabetes Month",EventKind::Awareness,RuleType::Month,11,0,0,0,0,1,Effect::Breath,C1(0x0096FF),1 },
{"evt182","COPD Awareness Month",EventKind::Awareness,RuleType::Month,11,0,0,0,0,1,Effect::Breath,C1(0xFF0D00),1 },
{"evt183","Lung Cancer Awareness Month",EventKind::Awareness,RuleType::Month,11,0,0,0,0,1,Effect::Breath,C1(0xFFFFFA),1 },
{"evt184","Pancreatic Cancer Awareness Month",EventKind::Awareness,RuleType::Month,11,0,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt185","Epilepsy Awareness Month",EventKind::Awareness,RuleType::Month,11,0,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt186","National Family Caregivers Month",EventKind::Awareness,RuleType::Month,11,0,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt187","National Alzheimer's Disease Awareness Month",EventKind::Awareness,RuleType::Month,11,0,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt188","Homeless Youth Awareness Month",EventKind::Awareness,RuleType::Month,11,0,0,0,0,1,Effect::Breath,C1(0x28FF00),1 },
{"evt189","All Saints' Day",EventKind::Holiday,RuleType::Fixed,11,1,0,0,0,1,Effect::Breath,C2(0xFFFFFA,0xFFA000),2 },
{"evt190","All Souls' Day",EventKind::Holiday,RuleType::Fixed,11,2,0,0,0,1,Effect::Breath,C2(0x5B00E6,0xFFFFFA),2 },
{"evt191","Election Day",EventKind::Awareness,RuleType::NthWeekday,11,0,1,1,1,1,Effect::Breath,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt192","Diwali / Deepavali",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,1,Effect::Jump,C3(0xFFA000,0xFF0000,0xFF0D00),3 },
{"evt193","Veterans Day",EventKind::Holiday,RuleType::Fixed,11,11,0,0,0,1,Effect::Jump,C4(0xFF0000,0xFFFFFA,0x0D00FF,0xFFA000),4 },
{"evt194","World Diabetes Day",EventKind::Awareness,RuleType::Fixed,11,14,0,0,0,1,Effect::Breath,C1(0x0096FF),1 },
{"evt195","World Prematurity Day",EventKind::Awareness,RuleType::Fixed,11,17,0,0,0,1,Effect::Breath,C1(0x5B00E6),1 },
{"evt196","Transgender Day of Remembrance",EventKind::Awareness,RuleType::Fixed,11,20,0,0,0,1,Effect::Breath,C3(0x0096FF,0xFF0024,0xFFFFFA),3 },
{"evt197","Thanksgiving",EventKind::Holiday,RuleType::NthWeekday,11,0,4,4,0,1,Effect::Jump,C3(0xFF0D00,0xFF0000,0xFFA000),3 },
{"evt198","Native American Heritage Day",EventKind::Awareness,RuleType::NthWeekday,11,0,4,4,1,1,Effect::Breath,C3(0xFF0000,0xFFA000,0xFFFFFA),3 },
{"evt199","National Impaired Driving Prevention Month",EventKind::Awareness,RuleType::Month,12,0,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt200","World AIDS Day",EventKind::Awareness,RuleType::Fixed,12,1,0,0,0,1,Effect::Breath,C1(0xFF0000),1 },
{"evt201","International Day of Persons with Disabilities",EventKind::Awareness,RuleType::Fixed,12,3,0,0,0,1,Effect::Breath,C2(0x5B00E6,0x0096FF),2 },
{"evt202","Hanukkah",EventKind::Holiday,RuleType::YearTable,0,0,0,0,0,8,Effect::Breath,C2(0x0096FF,0xFFFFFA),2 },
{"evt203","Pearl Harbor Remembrance Day",EventKind::Holiday,RuleType::Fixed,12,7,0,0,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt204","Human Rights Day",EventKind::Awareness,RuleType::Fixed,12,10,0,0,0,1,Effect::Breath,C2(0x0096FF,0xFFFFFA),2 },
{"evt205","Bill of Rights Day",EventKind::Awareness,RuleType::Fixed,12,15,0,0,0,1,Effect::Jump,C3(0xFF0000,0xFFFFFA,0x0D00FF),3 },
{"evt206","Winter Solstice",EventKind::Seasonal,RuleType::Fixed,12,21,0,0,0,1,Effect::Breath,C3(0xFFFFFA,0x00B4B4,0x0096FF),3 },
{"evt207","Christmas Eve",EventKind::Holiday,RuleType::Fixed,12,24,0,0,0,1,Effect::Jump,C3(0xFF0000,0x28FF00,0xFFA000),3 },
{"evt208","Christmas Day",EventKind::Holiday,RuleType::Fixed,12,25,0,0,0,1,Effect::Jump,C4(0xFF0000,0x28FF00,0xFFA000,0xFFFFFA),4 },
{"evt209","Kwanzaa",EventKind::Holiday,RuleType::Fixed,12,26,0,0,0,7,Effect::Breath,C2(0xFF0000,0x28FF00),2 },
{"evt210","New Year's Eve",EventKind::Holiday,RuleType::Fixed,12,31,0,0,0,1,Effect::Strobe,C4(0xFFA000,0xA0A5AF,0xFFFFFA,0x5B00E6),4 },
};
const size_t EVENT_COUNT = sizeof(EVENTS)/sizeof(EVENTS[0]);

static const uint8_t EVENT_SPEEDS[] = {
  1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 1, 2, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 1, 1, 2, 2, 2, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2
};
static_assert(sizeof(EVENT_SPEEDS)/sizeof(EVENT_SPEEDS[0]) == sizeof(EVENTS)/sizeof(EVENTS[0]), "event speed table mismatch");

struct SpecialDate { const char* id; int16_t year; uint8_t month; uint8_t day; };
static const SpecialDate SPECIAL_DATES[] = {
  {"evt028",2026,2,17},
  {"evt028",2027,2,6},
  {"evt028",2028,1,26},
  {"evt028",2029,2,13},
  {"evt028",2030,2,3},
  {"evt028",2031,1,23},
  {"evt028",2032,2,11},
  {"evt028",2033,1,31},
  {"evt028",2034,2,19},
  {"evt028",2035,2,8},
  {"evt028",2036,1,28},
  {"evt030",2026,2,18},
  {"evt030",2027,2,8},
  {"evt030",2028,1,28},
  {"evt030",2029,1,16},
  {"evt030",2030,1,6},
  {"evt030",2031,12,15},
  {"evt030",2032,12,4},
  {"evt030",2033,11,23},
  {"evt030",2034,11,12},
  {"evt030",2035,11,2},
  {"evt030",2036,10,21},
  {"evt047",2026,3,20},
  {"evt047",2027,3,10},
  {"evt047",2028,2,27},
  {"evt047",2029,2,15},
  {"evt047",2030,2,5},
  {"evt047",2031,1,25},
  {"evt047",2032,1,14},
  {"evt047",2033,1,3},
  {"evt047",2034,12,12},
  {"evt047",2035,12,1},
  {"evt047",2036,11,19},
  {"evt063",2026,4,1},
  {"evt069",2026,4,14},
  {"evt069",2027,5,4},
  {"evt069",2028,4,24},
  {"evt069",2029,4,12},
  {"evt069",2030,4,30},
  {"evt069",2031,4,21},
  {"evt069",2032,4,8},
  {"evt096",2026,5,27},
  {"evt096",2027,5,17},
  {"evt096",2028,5,5},
  {"evt096",2029,4,24},
  {"evt096",2030,4,14},
  {"evt096",2031,4,3},
  {"evt096",2032,3,22},
  {"evt096",2033,3,12},
  {"evt096",2034,3,1},
  {"evt096",2035,2,18},
  {"evt096",2036,2,8},
  {"evt148",2026,9,12},
  {"evt153",2026,9,21},
  {"evt177",2026,10,20},
  {"evt177",2027,10,9},
  {"evt177",2028,9,27},
  {"evt177",2029,10,16},
  {"evt177",2030,10,5},
  {"evt192",2026,11,8},
  {"evt192",2027,10,28},
  {"evt192",2028,10,17},
  {"evt192",2029,11,5},
  {"evt192",2030,10,25},
  {"evt202",2026,12,5},
  {"evt202",2027,12,25},
  {"evt202",2028,12,13},
  {"evt202",2029,12,2},
  {"evt202",2030,12,21},
  {"evt202",2031,12,10},
  {"evt202",2032,11,28},
  {"evt202",2033,12,17},
  {"evt202",2034,12,7},
  {"evt202",2035,12,26},
  {"evt202",2036,12,14},
  {"evt202",2037,12,4},
  {"evt202",2038,12,22},
  {"evt202",2039,12,11},
  {"evt202",2040,11,29},
  {"evt202",2041,12,18},
  {"evt202",2042,12,8},
  {"evt202",2043,12,27},
  {"evt202",2044,12,15},
  {"evt202",2045,12,5},
  {"evt028",2037,2,15},
  {"evt030",2037,10,11},
  {"evt047",2037,11,9},
  {"evt063",2027,4,21},
  {"evt063",2028,4,10},
  {"evt063",2029,3,30},
  {"evt063",2030,4,17},
  {"evt063",2031,4,7},
  {"evt063",2032,3,26},
  {"evt063",2033,4,13},
  {"evt063",2034,4,3},
  {"evt063",2035,4,23},
  {"evt063",2036,4,11},
  {"evt063",2037,3,30},
  {"evt069",2033,4,26},
  {"evt069",2034,4,17},
  {"evt069",2035,5,7},
  {"evt069",2036,4,24},
  {"evt069",2037,4,13},
  {"evt096",2037,1,27},
  {"evt148",2027,10,2},
  {"evt148",2028,9,21},
  {"evt148",2029,9,10},
  {"evt148",2030,9,28},
  {"evt148",2031,9,18},
  {"evt148",2032,9,6},
  {"evt148",2033,9,24},
  {"evt148",2034,9,14},
  {"evt148",2035,10,4},
  {"evt148",2036,9,22},
  {"evt148",2037,9,10},
  {"evt153",2027,10,11},
  {"evt153",2028,9,30},
  {"evt153",2029,9,19},
  {"evt153",2030,10,7},
  {"evt153",2031,9,27},
  {"evt153",2032,9,15},
  {"evt153",2033,10,3},
  {"evt153",2034,9,23},
  {"evt153",2035,10,13},
  {"evt153",2036,10,1},
  {"evt153",2037,9,19},
  {"evt177",2031,10,25},
  {"evt177",2032,10,14},
  {"evt177",2033,10,3},
  {"evt177",2034,10,22},
  {"evt177",2035,10,11},
  {"evt177",2036,9,29},
  {"evt177",2037,10,18},
  {"evt192",2031,11,14},
  {"evt192",2032,11,2},
  {"evt192",2033,10,22},
  {"evt192",2034,11,10},
  {"evt192",2035,10,30},
  {"evt192",2036,10,18},
  {"evt192",2037,11,7},
};

static bool leap(int y){return (y%4==0 && y%100!=0)||y%400==0;}
static int dim(int y,int m){static const int d[]={31,28,31,30,31,30,31,31,30,31,30,31};return m==2?d[1]+(leap(y)?1:0):d[m-1];}
static int dow(int y,int m,int d){tm t{};t.tm_year=y-1900;t.tm_mon=m-1;t.tm_mday=d;t.tm_hour=12;t.tm_isdst=-1;time_t x=mktime(&t);tm out{};localtime_r(&x,&out);return out.tm_wday;}
static void easter(int Y,int& M,int& D){int a=Y%19,b=Y/100,c=Y%100,d=b/4,e=b%4,f=(b+8)/25,g=(b-f+1)/3,h=(19*a+b-d-g+15)%30,i=c/4,k=c%4,l=(32+2*e+2*i-h-k)%7,m=(a+11*h+22*l)/451;M=(h+l-7*m+114)/31;D=((h+l-7*m+114)%31)+1;}
static time_t mk(int y,int m,int d){tm t{};t.tm_year=y-1900;t.tm_mon=m-1;t.tm_mday=d;t.tm_hour=12;t.tm_isdst=-1;return mktime(&t);}
static bool ymd(time_t x,int y,int m,int d){if(!x)return false;tm t{};localtime_r(&x,&t);return t.tm_year+1900==y&&t.tm_mon+1==m&&t.tm_mday==d;}
static const char* monthName(int m){static const char* n[]={"","January","February","March","April","May","June","July","August","September","October","November","December"};return m>=1&&m<=12?n[m]:"";}

static bool specialDate(const char* id,int year,int& month,int& day){
  for(const auto& x:SPECIAL_DATES)if(x.year==year&&!strcmp(x.id,id)){month=x.month;day=x.day;return true;}
  return false;
}

int eventIndexById(const String& id){
  for(size_t i=0;i<EVENT_COUNT;i++)if(id==EVENTS[i].id)return (int)i;
  return -1;
}

uint8_t eventSpeed(size_t index){return index<EVENT_COUNT?EVENT_SPEEDS[index]:1;}

time_t eventStartEpoch(size_t i,int year){
  if(i>=EVENT_COUNT)return 0;const auto&e=EVENTS[i];int m=e.month,d=e.day;
  switch(e.rule){
    case RuleType::Month:return mk(year,e.month,1);
    case RuleType::Fixed:return mk(year,e.month,e.day);
    case RuleType::NthWeekday:{
      int first=dow(year,e.month,1);d=1+((e.weekday-first+7)%7)+7*(e.nth-1);
      return mk(year,e.month,d)+(time_t)e.offsetDays*86400;
    }
    case RuleType::LastWeekday:{
      d=dim(year,e.month);int last=dow(year,e.month,d);d-=((last-e.weekday+7)%7);
      return mk(year,e.month,d)+(time_t)e.offsetDays*86400;
    }
    case RuleType::EasterOffset:easter(year,m,d);return mk(year,m,d)+(time_t)e.offsetDays*86400;
    case RuleType::MonthEnd:return mk(year,e.month,dim(year,e.month));
    case RuleType::YearTable:
      if(!specialDate(e.id,year,m,d))return 0;
      return mk(year,m,d);
    case RuleType::Hanukkah:
      if(!specialDate("evt202",year,m,d))return 0;
      return mk(year,m,d);
  }
  return 0;
}

static bool shiftedLocalDate(time_t start,int offset,int& year,int& month,int& day){
  if(!start)return false;tm t{};localtime_r(&start,&t);t.tm_mday+=offset;t.tm_hour=12;t.tm_min=0;t.tm_sec=0;t.tm_isdst=-1;if(mktime(&t)==(time_t)-1)return false;year=t.tm_year+1900;month=t.tm_mon+1;day=t.tm_mday;return true;
}
static bool shiftedDateEquals(time_t start,int offset,int year,int month,int day){int y=0,m=0,d=0;return shiftedLocalDate(start,offset,y,m,d)&&y==year&&m==month&&d==day;}

bool eventOccursInMonth(size_t i,int year,int month){
  if(i>=EVENT_COUNT)return false;const auto&e=EVENTS[i];if(e.rule==RuleType::Month)return e.month==month;
  for(int sy=year-1;sy<=year;sy++){time_t start=eventStartEpoch(i,sy);if(!start)continue;for(int k=0;k<max(1,(int)e.durationDays);k++){int y=0,m=0,d=0;if(shiftedLocalDate(start,k,y,m,d)&&y==year&&m==month)return true;}}return false;
}

bool eventActiveOn(size_t i,const tm& local){
  if(i>=EVENT_COUNT)return false;const auto&e=EVENTS[i];int y=local.tm_year+1900,m=local.tm_mon+1,d=local.tm_mday;if(e.rule==RuleType::Month)return e.month==m;
  for(int sy=y-1;sy<=y;sy++){time_t start=eventStartEpoch(i,sy);if(!start)continue;for(int k=0;k<max(1,(int)e.durationDays);k++)if(shiftedDateEquals(start,k,y,m,d))return true;}return false;
}

bool eventWindowActiveOn(size_t i,const tm& local,uint8_t lead,uint8_t trail){
  if(i>=EVENT_COUNT||EVENTS[i].kind!=EventKind::Holiday||EVENTS[i].rule==RuleType::Month)return false;
  int y=local.tm_year+1900,m=local.tm_mon+1,d=local.tm_mday,duration=max(1,(int)EVENTS[i].durationDays);
  if(eventActiveOn(i,local))return false;
  for(int sy=y-1;sy<=y+1;sy++){time_t start=eventStartEpoch(i,sy);if(!start)continue;for(int k=-(int)lead;k<duration+(int)trail;k++){if(k>=0&&k<duration)continue;if(shiftedDateEquals(start,k,y,m,d))return true;}}return false;
}

String eventWhen(size_t i,int year){
  if(i>=EVENT_COUNT)return "";const auto&e=EVENTS[i];
  if(e.rule==RuleType::Month)return String(monthName(e.month))+" (all month)";
  time_t s=eventStartEpoch(i,year);if(!s)return String("No scheduled date for ")+String(year);
  tm a{};localtime_r(&s,&a);char first[24];snprintf(first,sizeof(first),"%s %d",monthName(a.tm_mon+1),a.tm_mday);
  if(e.durationDays<=1)return String(first);
  time_t end=s+(time_t)(e.durationDays-1)*86400;tm b{};localtime_r(&end,&b);char last[24];
  if(a.tm_mon==b.tm_mon)snprintf(last,sizeof(last),"%d",b.tm_mday);
  else snprintf(last,sizeof(last),"%s %d",monthName(b.tm_mon+1),b.tm_mday);
  return String(first)+" - "+String(last);
}

Theme themeFromEvent(size_t i){
  Theme t;if(i>=EVENT_COUNT)return t;const auto&e=EVENTS[i];t.name=e.name;t.effect=e.effect;t.colorCount=min((uint8_t)6,e.colorCount);
  for(uint8_t c=0;c<t.colorCount;c++)t.colors[c]=e.colors[c];
  if(!t.colorCount){t.colors[0]=0xFFFFFA;t.colorCount=1;}
  return t;
}
