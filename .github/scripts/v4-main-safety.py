from pathlib import Path

p=Path('firmware/src/main.cpp')
s=p.read_text()

# Move remaining PIN hashing off the removed Mbed TLS legacy SHA API.
old='#include <mbedtls/sha256.h>'
assert s.count(old)==1, 'expected one legacy sha include in main.cpp'
s=s.replace(old,'#include "AndersonSha256.h"',1)
old='if(mbedtls_sha256((const uint8_t*)material.c_str(),material.length(),digest,0)!=0)return "";'
new='if(andersonSha256Compute((const uint8_t*)material.c_str(),material.length(),digest)!=0)return "";'
assert s.count(old)==1, 'expected one legacy PIN digest call'
s=s.replace(old,new,1)

# Track explicit ESP application-image header validation for local/emergency uploads.
old='bool otaUploadAllowed=false,otaUploadOk=false,otaRecoveryRequest=false,otaExternalClaimed=false;int otaUploadResponseCode=403;String otaUploadError;'
new='bool otaUploadAllowed=false,otaUploadOk=false,otaRecoveryRequest=false,otaExternalClaimed=false,otaUploadHeaderChecked=false;int otaUploadResponseCode=403;String otaUploadError;'
assert s.count(old)==1, 'expected OTA upload state declaration'
s=s.replace(old,new,1)

old='otaUploadAllowed=true;otaUploadOk=false;otaUploadResponseCode=403;otaRecoveryRequest=server.hasArg("recovery")&&server.arg("recovery")=="1";otaUploadError="";'
new='otaUploadAllowed=true;otaUploadOk=false;otaUploadHeaderChecked=false;otaUploadResponseCode=403;otaRecoveryRequest=server.hasArg("recovery")&&server.arg("recovery")=="1";otaUploadError="";'
assert s.count(old)==1, 'expected OTA upload start state'
s=s.replace(old,new,1)

# Reject obviously wrong/full-flash images before touching the inactive APP slot.
needle='String fn=u.filename;fn.toLowerCase();if(!fn.endsWith(".bin")){otaUploadAllowed=false;otaUploadResponseCode=400;otaUploadError="Select an app-only .bin firmware file";return;}\n      if(!remoteUpdateTryClaimExternalOperation())'
repl='String fn=u.filename;fn.toLowerCase();if(!fn.endsWith(".bin")){otaUploadAllowed=false;otaUploadResponseCode=400;otaUploadError="Select an app-only .bin firmware file";return;}\n      if(u.totalSize<4096||u.totalSize>=0x1E0000){otaUploadAllowed=false;otaUploadResponseCode=400;otaUploadError="Firmware size is not valid for the APP-only OTA slot";return;}\n      if(!remoteUpdateTryClaimExternalOperation())'
assert s.count(needle)==1, 'expected OTA filename validation block'
s=s.replace(needle,repl,1)

old='''    }else if(u.status==UPLOAD_FILE_WRITE){
      if(otaUploadAllowed&&!otaUploadError.length()&&Update.write(u.buf,u.currentSize)!=u.currentSize){otaUploadResponseCode=500;otaUploadError=String("Firmware write failed. Error ")+String(Update.getError());Update.abort();otaUploadAllowed=false;if(otaExternalClaimed){remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}}
    }else if(u.status==UPLOAD_FILE_END){
      if(otaUploadAllowed&&!otaUploadError.length()){otaUploadOk=Update.end(true);if(!otaUploadOk){otaUploadResponseCode=500;otaUploadError=String("Firmware validation failed. Error ")+String(Update.getError());}}if(otaExternalClaimed){remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}
'''
new='''    }else if(u.status==UPLOAD_FILE_WRITE){
      if(otaUploadAllowed&&!otaUploadError.length()&&!otaUploadHeaderChecked){
        if(!u.buf||u.currentSize==0||u.buf[0]!=0xE9){otaUploadResponseCode=400;otaUploadError="Firmware is not an ESP APP image (missing 0xE9 image header)";Update.abort();otaUploadAllowed=false;if(otaExternalClaimed){remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}return;}
        otaUploadHeaderChecked=true;
      }
      if(otaUploadAllowed&&!otaUploadError.length()&&Update.write(u.buf,u.currentSize)!=u.currentSize){otaUploadResponseCode=500;otaUploadError=String("Firmware write failed. Error ")+String(Update.getError());Update.abort();otaUploadAllowed=false;if(otaExternalClaimed){remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}}
    }else if(u.status==UPLOAD_FILE_END){
      if(otaUploadAllowed&&!otaUploadError.length()&&!otaUploadHeaderChecked){otaUploadAllowed=false;otaUploadResponseCode=400;otaUploadError="Firmware APP image header was not received";Update.abort();}
      if(otaUploadAllowed&&!otaUploadError.length()){otaUploadOk=Update.end(true);if(!otaUploadOk){otaUploadResponseCode=500;otaUploadError=String("Firmware validation failed. Error ")+String(Update.getError());}}if(otaExternalClaimed){remoteUpdateReleaseExternalOperation();otaExternalClaimed=false;}
'''
assert s.count(old)==1, 'expected OTA write/end block'
s=s.replace(old,new,1)

p.write_text(s)
