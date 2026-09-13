from pathlib import Path
import re
p=Path('firmware/src/RemoteUpdate.cpp')
s=p.read_text()
if '#include <esp_ota_ops.h>' not in s:
    s=s.replace('#include <Update.h>','#include <Update.h>\n#include <esp_ota_ops.h>')
new=r'''static bool downloadAndStage(){
  last.installing=true;last.installReady=false;last.downloadedBytes=0;
  const esp_partition_t* target=esp_ota_get_next_update_partition(nullptr);
  if(!target||target->size<last.bytes){last.ok=false;last.installing=false;last.message="No valid inactive OTA slot";return false;}
  WiFiClientSecure client;client.setInsecure();client.setHandshakeTimeout(12);feedControllerWatchdog();
  HTTPClient http;http.setConnectTimeout(6000);http.setTimeout(12000);http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
  if(!http.begin(client,last.url)){last.ok=false;last.installing=false;last.message="Could not open the signed firmware URL";return false;}
  int code=http.GET();last.httpStatus=code;
  if(code!=HTTP_CODE_OK){last.ok=false;last.installing=false;last.message=String("Firmware download failed (HTTP ")+String(code)+")";http.end();return false;}
  int announced=http.getSize();if(announced>0&&(size_t)announced!=last.bytes){last.ok=false;last.installing=false;last.message="Firmware Content-Length does not match the signed manifest";http.end();return false;}
  esp_ota_handle_t handle=0;esp_err_t err=esp_ota_begin(target,last.bytes,&handle);
  if(err!=ESP_OK){last.ok=false;last.installing=false;last.message=String("Native OTA begin failed: ")+esp_err_to_name(err);http.end();return false;}
  mbedtls_sha256_context sha;mbedtls_sha256_init(&sha);
  if(mbedtls_sha256_starts(&sha,0)!=0){esp_ota_abort(handle);mbedtls_sha256_free(&sha);http.end();last.ok=false;last.installing=false;last.message="Could not start SHA-256 verification";return false;}
  NetworkClient* stream=http.getStreamPtr();uint8_t buffer[2048];size_t total=0;uint32_t lastData=millis();bool failed=false;String failure;
  while(total<last.bytes){feedControllerWatchdog();int available=stream->available();if(available>0){size_t want=(size_t)available;if(want>sizeof(buffer))want=sizeof(buffer);if(want>last.bytes-total)want=last.bytes-total;int got=stream->read(buffer,want);if(got>0){if(mbedtls_sha256_update(&sha,buffer,(size_t)got)!=0){failed=true;failure="SHA-256 update failed";break;}err=esp_ota_write(handle,buffer,(size_t)got);if(err!=ESP_OK){failed=true;failure=String("Native OTA write failed: ")+esp_err_to_name(err);break;}total+=(size_t)got;last.downloadedBytes=total;lastData=millis();continue;}}if((uint32_t)(millis()-lastData)>12000UL){failed=true;failure="Firmware download stalled before the signed byte count was received";break;}delay(1);}
  uint8_t digest[32];bool hashFinished=!failed&&mbedtls_sha256_finish(&sha,digest)==0;mbedtls_sha256_free(&sha);http.end();
  if(failed||!hashFinished||total!=last.bytes){esp_ota_abort(handle);last.ok=false;last.installing=false;last.message=failure.length()?failure:(!hashFinished?"Could not finish SHA-256 verification":"Firmware download ended before the signed byte count");return false;}
  String actual=hexBytes(digest,sizeof(digest));if(actual!=last.sha256){esp_ota_abort(handle);last.ok=false;last.installing=false;last.message="Downloaded firmware SHA-256 does not match the signed manifest";return false;}
  err=esp_ota_end(handle);if(err!=ESP_OK){last.ok=false;last.installing=false;last.message=String("Native OTA validation failed: ")+esp_err_to_name(err);return false;}
  err=esp_ota_set_boot_partition(target);if(err!=ESP_OK){last.ok=false;last.installing=false;last.message=String("Could not select repaired OTA slot: ")+esp_err_to_name(err);return false;}
  // Recovery metadata is best-effort. NVS failure must never veto a fully verified OTA image.
  (void)setPending(last);
  last.installing=false;last.installReady=true;last.updateAvailable=false;last.ok=true;
  last.message=String("Remote firmware ")+last.availableVersion+" downloaded, SHA-256 verified, validated by native ESP-IDF OTA, and selected for reboot.";
  saveLastMessage(last.availableVersion,String("Remote firmware ")+last.availableVersion+" verified and selected for reboot.");
  rebootRequested=true;return true;
}

'''
pat=r'static bool downloadAndStage\(\)\{.*?\n\n(?=String remoteUpdateInstallJson)'
s,n=re.subn(pat,new,s,flags=re.S)
assert n==1,n
p.write_text(s)
main=Path('firmware/src/main.cpp');m=main.read_text();m,n=re.subn(r'ANDERSON_FIRMWARE_VERSION="4\.5\.1"','ANDERSON_FIRMWARE_VERSION="4.5.2"',m);assert n==1,n;main.write_text(m)
Path('FIRMWARE_VERSION.txt').write_text('4.5.2\n')
print('4.5.2 native OTA repair materialized')
