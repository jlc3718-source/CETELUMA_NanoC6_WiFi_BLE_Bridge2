#pragma once
#include "Common.h"
bool handleFactoryApi(const String&path,JsonVariantConst input,bool post,bool busy);
bool refreshFactoryCatalog();
bool fetchFactoryPreset(int id,JsonDocument&out);
Bytes nativeFactoryFields(JsonVariantConst preset,bool e22,bool reverse);
void factoryCompatibleScene(JsonVariantConst preset,JsonObject scene);
void factoryPromotionRows(JsonArray rows);
bool queueLocalControl(JsonVariantConst request,String&id);
