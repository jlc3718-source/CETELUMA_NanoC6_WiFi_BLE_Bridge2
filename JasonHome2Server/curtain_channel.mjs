import {WebSocketServer,WebSocket} from './curtain_transport/node_modules/ws/wrapper.mjs';

// One authenticated outbound TLS socket carries commands, receipts and status.
// Enqueue pushes the actual payload; the Nano never has to fetch the command.
export function attachCurtainChannel(server,bridge){
 const wss=new WebSocketServer({noServer:true,maxPayload:16384,perMessageDeflate:false});
 server.on('upgrade',(req,socket,head)=>{
  if(new URL(req.url,'http://localhost').pathname!=='/api/curtain-bridge/channel'){
   socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');return;
  }
  const credential=bridge.authenticate(req);
  if(!credential){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,credential));
 });
 wss.on('connection',(ws,req,credential)=>{
  let hello=false,alive=true,scheduled=false,closed=false,receivedId=0,channelClosed=null;
  const send=(data,reportId)=>{
   if(closed||ws.readyState!==WebSocket.OPEN)return;
   if(!bridge.authenticate(req)){ws.close(1008,'Bridge credential changed');return;}
   if(ws.bufferedAmount>65536){ws.terminate();return;}
   const commands=data.commands.filter(c=>c.id>receivedId).slice(0,1);
   const assets=data.assets.filter(a=>commands.some(c=>c.action==='asset'&&c.payload.sha256===a.sha256));
   const payload={type:'delivery',serverTime:data.serverTime??Date.now(),revision:data.revision,
    commands,assets,credential:data.credential??null};
   if(reportId!==undefined)payload.reportId=reportId;
   ws.send(JSON.stringify(payload));
  };
  const wake=()=>{
   if(!hello||scheduled||closed)return;
   scheduled=true;setImmediate(()=>{scheduled=false;if(!closed&&ws.readyState===WebSocket.OPEN)send(bridge.delivery());});
  };
  const unsubscribe=bridge.subscribeWake(wake);
  const timer=setInterval(()=>{if(!alive){ws.terminate();return;}alive=false;ws.ping();},15000);
  timer.unref();
  ws.on('pong',()=>{alive=true;});
  ws.on('message',(bytes,binary)=>{
   if(binary){ws.close(1003,'JSON required');return;}
   try{
    const body=JSON.parse(bytes.toString());
    if(body.type!=='state'||!Number.isSafeInteger(body.reportId)||body.reportId<1||typeof body.bootId!=='string')
     throw Error('Invalid bridge report');
    // Authentication is checked again on every report, including token rotation.
    const current=bridge.authenticate(req);
    if(!current){ws.close(1008,'Bridge credential changed');return;}
    alive=true;if(!hello)channelClosed=bridge.channelOpened();hello=true;
    for(const ack of body.acks||[])if(['downloaded','applied','failed'].includes(ack.state)&&Number.isSafeInteger(ack.id))receivedId=Math.max(receivedId,ack.id);
    send(bridge.sync(body,current),body.reportId);
   }catch{ws.close(1008,'Invalid bridge report');}
  });
  ws.on('error',()=>{});
  ws.once('close',()=>{closed=true;clearInterval(timer);unsubscribe();channelClosed?.();});
 });
 return wss;
}
