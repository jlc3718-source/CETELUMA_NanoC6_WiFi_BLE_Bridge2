#include "ESPmDNS.h"
#include "mdns.h"

MDNSClass MDNS;

bool MDNSClass::begin(const char* host){
  end();
  host_=(host&&*host)?host:"anderson-home";
  if(mdns_init()!=ESP_OK)return false;
  if(mdns_hostname_set(host_.c_str())!=ESP_OK){
    mdns_free();
    host_.clear();
    return false;
  }
  active_=true;
  return true;
}

void MDNSClass::setInstanceName(const char* name){
  if(!active_)return;
  mdns_instance_name_set((name&&*name)?name:"Anderson Home");
}

void MDNSClass::addService(const char* service,const char* proto,uint16_t port){
  if(!active_||!service||!*service||!proto||!*proto||!port)return;
  mdns_service_add(nullptr,service,proto,port,nullptr,0);
}

void MDNSClass::end(){
  if(active_){
    mdns_free();
    active_=false;
  }
  host_.clear();
}
