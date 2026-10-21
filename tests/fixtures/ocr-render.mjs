let remaining=0,outstanding=0,window=1,mode=''
process.on('disconnect',()=>process.exit(0))
function pump(){
 while(remaining&&outstanding<window){remaining--;outstanding++;process.send({type:'page',page:3-remaining,png:Buffer.from('PNG')})}
 if(!remaining&&!outstanding)process.send({type:'done'})
}
process.on('message',message=>{
 if(message.type==='render'){
  mode=Buffer.from(message.bytes).toString();if(mode==='hang')return
  if(mode==='crash'){process.exit(86);return}
  remaining=3;window=message.window;pump()
 }else if(message.type==='ack'){outstanding--;if(mode==='fail'){process.send({type:'error',message:'broken page 2'});return}pump()}
})
