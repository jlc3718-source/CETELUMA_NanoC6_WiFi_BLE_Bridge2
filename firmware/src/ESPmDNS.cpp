#include "ESPmDNS.h"
#include "mdns.h"
MDNSClass MDNS;
bool MDNSClass::begin(const char* host){end();if(mdns_init()!=ESP_OK)return false;active_=true;host_=host?host:"anderson-home";mdns_hostname_set(host_.c_str());return true;}
void MDNSClass::setInstanceName(const char* n){if(active_)mdns_instance_name_set(n?n:"Anderson Home");}
void MDNSClass::addService(const char* s,const char* p,uint16_t port){if(active_)mdns_service_add(nullptr,s,p,port,nullptr,0);}
void MDNSClass::end(){if(active_){mdns_free();active_=false;}}
