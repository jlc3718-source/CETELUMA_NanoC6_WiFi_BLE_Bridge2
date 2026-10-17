#pragma once
#include <WiFi.h>
#include <WiFiClientSecure.h>

// WebSockets creates its own secure client on each reconnect. Configure that
// actual client; Common::trust() is not called by the WebSockets library.
using WebSocketsNetworkClient=WiFiClient;
class WebSocketsNetworkClientSecure:public WiFiClientSecure {
 public:
 WebSocketsNetworkClientSecure(){setHandshakeTimeout(8);setTimeout(12000);}
};
