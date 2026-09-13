#include "BootHealth.h"
#include <esp_app_desc.h>
#include <esp_log.h>
#include <esp_ota_ops.h>
#include <esp_system.h>
#include <esp_timer.h>
#include <lwip/inet.h>
#include <lwip/sockets.h>
#include <string>
#include <cstring>

namespace {
static const char* TAG="anderson-boot-health";
static bool pending=false;
static bool finished=false;
static int64_t startedUs=0;
static int64_t nextAttemptUs=0;
static constexpr int64_t FIRST_TEST_DELAY_US=3LL*1000000LL;
static constexpr int64_t RETRY_DELAY_US=3LL*1000000LL;
static constexpr int64_t ROLLBACK_DEADLINE_US=45LL*1000000LL;

bool fetchLocal(const char* path,std::string& response){
  int fd=socket(AF_INET,SOCK_STREAM,IPPROTO_IP);
  if(fd<0)return false;
  timeval tv{};tv.tv_sec=2;tv.tv_usec=0;
  setsockopt(fd,SOL_SOCKET,SO_RCVTIMEO,&tv,sizeof(tv));
  setsockopt(fd,SOL_SOCKET,SO_SNDTIMEO,&tv,sizeof(tv));
  sockaddr_in addr{};addr.sin_family=AF_INET;addr.sin_port=htons(80);addr.sin_addr.s_addr=inet_addr("127.0.0.1");
  if(connect(fd,reinterpret_cast<sockaddr*>(&addr),sizeof(addr))!=0){close(fd);return false;}
  std::string req="GET ";req+=path;req+=" HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nCache-Control: no-cache\r\n\r\n";
  size_t sent=0;
  while(sent<req.size()){
    int n=send(fd,req.data()+sent,req.size()-sent,0);
    if(n<=0){close(fd);return false;}
    sent+=(size_t)n;
  }
  response.clear();response.reserve(4096);
  char buf[768];
  while(response.size()<8192){
    int n=recv(fd,buf,sizeof(buf),0);
    if(n<0){close(fd);return false;}
    if(n==0)break;
    response.append(buf,(size_t)n);
    const auto headerEnd=response.find("\r\n\r\n");
    if(headerEnd!=std::string::npos&&response.size()>=headerEnd+6)break;
  }
  close(fd);
  return !response.empty();
}

bool rootProbe(){
  std::string r;if(!fetchLocal("/",r))return false;
  if(r.rfind("HTTP/1.1 200",0)!=0)return false;
  if(r.find("Content-Encoding: gzip")==std::string::npos&&r.find("content-encoding: gzip")==std::string::npos)return false;
  const auto h=r.find("\r\n\r\n");if(h==std::string::npos||r.size()<h+6)return false;
  const unsigned char b0=(unsigned char)r[h+4],b1=(unsigned char)r[h+5];
  return b0==0x1f&&b1==0x8b;
}

bool firmwareProbe(){
  std::string r;if(!fetchLocal("/api/firmware",r))return false;
  if(r.rfind("HTTP/1.1 200",0)!=0)return false;
  const auto h=r.find("\r\n\r\n");if(h==std::string::npos)return false;
  const esp_app_desc_t* app=esp_app_get_description();
  std::string needle="\"version\":\"";needle+=app?app->version:"";needle+="\"";
  return r.find(needle,h+4)!=std::string::npos;
}
}

void bootHealthBegin(){
  pending=false;finished=false;startedUs=esp_timer_get_time();nextAttemptUs=startedUs+FIRST_TEST_DELAY_US;
  const esp_partition_t* running=esp_ota_get_running_partition();
  if(!running){finished=true;ESP_LOGW(TAG,"Running partition unavailable; boot-health confirmation skipped");return;}
  esp_ota_img_states_t state=ESP_OTA_IMG_UNDEFINED;
  const esp_err_t rc=esp_ota_get_state_partition(running,&state);
  if(rc!=ESP_OK||state!=ESP_OTA_IMG_PENDING_VERIFY){finished=true;ESP_LOGI(TAG,"Running slot %s does not require rollback confirmation (state=%d rc=%s)",running->label,(int)state,esp_err_to_name(rc));return;}
  pending=true;
  ESP_LOGW(TAG,"Running slot %s is PENDING_VERIFY; root/API self-test required before confirming",running->label);
}

void bootHealthLoop(){
  if(finished||!pending)return;
  const int64_t now=esp_timer_get_time();
  if(now-startedUs>=ROLLBACK_DEADLINE_US){
    ESP_LOGE(TAG,"Boot-health deadline expired; rebooting without validation so bootloader can roll back");
    esp_restart();
    return;
  }
  if(now<nextAttemptUs)return;
  nextAttemptUs=now+RETRY_DELAY_US;
  const bool rootOk=rootProbe();
  const bool apiOk=rootOk&&firmwareProbe();
  if(!rootOk||!apiOk){ESP_LOGW(TAG,"Boot-health probe failed (root=%d api=%d); slot remains rollback-eligible",rootOk,apiOk);return;}
  const esp_err_t rc=esp_ota_mark_app_valid_cancel_rollback();
  if(rc==ESP_OK){pending=false;finished=true;ESP_LOGI(TAG,"Root gzip response and firmware API verified; OTA slot confirmed VALID");return;}
  ESP_LOGE(TAG,"Could not mark OTA slot valid: %s",esp_err_to_name(rc));
}

bool bootHealthPending(){return pending;}
