#pragma once
#include <Arduino.h>

static constexpr size_t MAX_BUILTIN_EVENTS = 256;
static constexpr size_t EVENT_STATE_WORDS = MAX_BUILTIN_EVENTS / 64;

void eventStateBegin();
bool eventStateEnabled(size_t index);
bool eventStateFavorite(size_t index);
bool eventStateSetEnabled(size_t index, bool enabled);
bool eventStateSetFavorite(size_t index, bool favorite);
bool eventStateReplaceFavorites(const size_t* indices, size_t count);
bool eventStateResetAll();
