import {createHash} from "node:crypto";
import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import path from "node:path";

/** Store only token digests, never DART keys or reversible connection codes. */
export const revocationConfigured=()=>Boolean((process.env.AGENT_REVOCATION_REDIS_URL && process.env.AGENT_REVOCATION_REDIS_TOKEN) || process.env.AGENT_REVOCATION_FILE);
const tokenId=(token:string)=>`dart-finder:revoked:${createHash("sha256").update(token).digest("hex")}`;
async function redis(command:string[]) {
  const url=(process.env.AGENT_REVOCATION_REDIS_URL||"").replace(/\/+$/,"");
  if(!url.startsWith("https://"))throw new Error("Revocation storage requires HTTPS");
  const response=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${process.env.AGENT_REVOCATION_REDIS_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify(command),signal:AbortSignal.timeout(5000),cache:"no-store"});
  if(!response.ok)throw new Error("Revocation storage unavailable");
  const payload=await response.json() as {result?:unknown;error?:string};
  if(payload.error)throw new Error("Revocation storage unavailable");
  return payload.result;
}
async function readIds():Promise<Set<string>> {
  try{const parsed=JSON.parse(await readFile(process.env.AGENT_REVOCATION_FILE!,"utf8"));if(!Array.isArray(parsed)||parsed.some(x=>typeof x!=="string"))throw new Error("Invalid revocation file");return new Set(parsed);}
  catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return new Set();throw error;}
}
let fileQueue:Promise<void>=Promise.resolve();
export async function isAgentTokenRevoked(token:string):Promise<boolean> {
  if(!revocationConfigured())return false;
  if(process.env.AGENT_REVOCATION_REDIS_URL){const result=await redis(["EXISTS",tokenId(token)]);if(result!==0 && result!==1)throw new Error("Invalid revocation response");return result===1;}
  await fileQueue;return (await readIds()).has(tokenId(token));
}
export async function revokeAgentToken(token:string):Promise<void> {
  if(!revocationConfigured())throw new Error("Revocation storage not configured");
  if(process.env.AGENT_REVOCATION_REDIS_URL){const result=await redis(["SET",tokenId(token),"1"]);if(result!=="OK")throw new Error("Revocation write not confirmed");return;}
  const operation=fileQueue.then(async()=>{const ids=await readIds();ids.add(tokenId(token));const file=process.env.AGENT_REVOCATION_FILE!;await mkdir(path.dirname(file),{recursive:true});const temporary=`${file}.${process.pid}.tmp`;await writeFile(temporary,JSON.stringify([...ids]),{mode:0o600});await rename(temporary,file);});
  fileQueue=operation.catch(()=>{});await operation;
}
