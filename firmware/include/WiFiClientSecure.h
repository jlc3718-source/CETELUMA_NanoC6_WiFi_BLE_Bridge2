#pragma once
class WiFiClientSecure {public:void setInsecure(){insecure_=true;}void setHandshakeTimeout(unsigned s){handshakeSeconds_=s;}bool insecure_=false;unsigned handshakeSeconds_=12;};
