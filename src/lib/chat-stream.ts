import type { ChatConversation, ChatMessage } from "./workspace-chat";
import { isChatProgress, type ChatProgress } from "./chat-progress";
export type ChatEnvelope={conversation:ChatConversation;message:ChatMessage;assistantMessage?:ChatMessage;replyError?:string};
export type ChatStreamEvent={event:'accepted'|'done'|'reply-error';data:ChatEnvelope}|{event:'delta';data:{text:string}}|{event:'progress';data:{stage:ChatProgress}};
// Fetch-based SSE supports authenticated POSTs and streams split at arbitrary
// byte boundaries, including inside UTF-8 codepoints and event delimiters.
export async function consumeChatStream(response:Response,onEvent:(event:ChatStreamEvent)=>void) {
  if(!response.ok){const data=await response.json();throw new Error(data.error||'Couldn’t save your question.');}
  if(!response.headers.get('content-type')?.includes('text/event-stream'))throw new Error('The chat service did not return a stream. Refresh and try again.');
  const reader=response.body?.getReader();if(!reader)throw new Error('The reply stream is empty.');
  const decoder=new TextDecoder();let buffer='',finished=false;
  try {
    for(;;) {
      const {value,done}=await reader.read();buffer+=decoder.decode(value,{stream:!done});
      let boundary;
      while((boundary=buffer.indexOf('\n\n'))>=0) {
        const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
        const event=frame.split('\n').find(line=>line.startsWith('event: '))?.slice(7);
        const raw=frame.split('\n').filter(line=>line.startsWith('data: ')).map(line=>line.slice(6)).join('\n');
        if(event==='ping'||!raw)continue;
        if(finished)throw new Error('Unexpected event after the reply finished.');
        const data=JSON.parse(raw);
        if(event==='delta') {if(typeof data.text!=='string')throw new Error('Invalid reply stream.');onEvent({event,data});}
        else if(event==='progress') {if(!isChatProgress(data?.stage))throw new Error('Invalid chat activity.');onEvent({event,data:{stage:data.stage}});}
        else if(event==='accepted'||event==='done'||event==='reply-error') {onEvent({event,data});if(event!=='accepted')finished=true;}
        else throw new Error('Invalid reply stream.');
      }
      if(done)break;
      if(buffer.length>2_000_000)throw new Error('Invalid reply stream.');
    }
    if(!finished||buffer.trim())throw new Error('The connection ended before the reply was saved. Reopen the conversation before trying again.');
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
