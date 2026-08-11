const BASE = process.argv[2] ?? "https://app-7xil-agents-stg-gzdxeng6cba9byac.uaenorth-01.azurewebsites.net";
async function turn(msg: string, cid?: string) {
  const t0 = Date.now(); let first: number | null = null; let tools = 0; let chars = 0;
  const res = await fetch(`${BASE}/api/chat`, { method: "POST", headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ agentSlug:"epgl-dialog", userMessage: msg, conversationId: cid, locale:"en" })});
  const reader = res.body!.getReader(); const dec = new TextDecoder(); let buf = ""; let id = cid;
  for(;;){ const {done,value}=await reader.read(); if(done) break;
    buf += dec.decode(value,{stream:true}); const parts=buf.split("\n\n"); buf=parts.pop()??"";
    for(const p of parts){ const l=p.split("\n").find(x=>x.startsWith("data:")); if(!l) continue;
      try{ const e=JSON.parse(l.slice(5));
        if(e.conversationId) id=e.conversationId;
        if(e.type==="text"){ if(first===null) first=Date.now()-t0; chars+=(e.delta??"").length; }
        if(e.type==="tool"||e.tool) tools++;
      }catch{} } }
  return { id: id!, ms: Date.now()-t0, first, tools, chars };
}
async function main(){
  const steps = [
    "I want to apply for a new courier licence",
    "Emre Karayalcin, emre.karayalcin@7x.ae",
    "my trade licence number is 241481, company First Flight Couriers (Middle East) LLC",
    "the licence expires 14-02-2027, emirate Dubai, regulator DED",
    "owner is Awadh Ali Abdulla Mohammed Alneyadi, Emirates ID 784-1999-8392642-1",
    "Al Merkadh",
  ];
  let cid: string | undefined;
  for (let i=0;i<steps.length;i++){
    const r = await turn(steps[i]!, cid); cid = r.id;
    console.log(`  turn ${i+1}: total ${(r.ms/1000).toFixed(1)}s  first-token ${r.first===null?"—":(r.first/1000).toFixed(1)+"s"}  tool-events ${r.tools}  reply ${r.chars} chars`);
  }
}
main();
