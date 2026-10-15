#include "PortMapping.h"
// Local-only bridge: no UPnP discovery, TCP forwarding, or TP-Link DDNS.
void portMappingRetry() {}
void portMappingLoop() {}
void portMappingStatus(JsonObject out) {
  out["enabled"]=false;
  out["mapped"]=false;
  out["owned"]=false;
  out["externalReachabilityVerified"]=false;
  out["status"]="Local-only mode; no external port mapping";
  out["remoteUrl"]="";
}
