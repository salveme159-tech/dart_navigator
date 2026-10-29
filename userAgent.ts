import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Express, Response } from "express";

// No expiry and no process-local session store. The same secret must survive redeploys.
const TOKEN_PATTERN = /^dn1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{54}\.[A-Za-z0-9_-]{22}$/;
const AAD = Buffer.from("DART-Navigator:user-connection:v1");
const validDartKey = (key: unknown): key is string => typeof key === "string" && /^[A-Za-z0-9]{40}$/.test(key) && !/^(DEMO|VERIFIED)/i.test(key);
const readEncryptionKey = () => {
  const secret = (process.env.AGENT_CONNECTION_SECRET ?? "").trim();
  return secret.length >= 32 ? createHash("sha256").update(secret).digest() : null;
};
const issueToken = (dartKey: string, key: Buffer) => {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(dartKey, "utf8"), cipher.final()]);
  return ["dn1", iv.toString("base64url"), ciphertext.toString("base64url"), cipher.getAuthTag().toString("base64url")].join(".");
};
const resolveToken = (token: unknown, key: Buffer): string | null => {
  if (typeof token !== "string" || !TOKEN_PATTERN.test(token)) return null;
  try {
    const [,iv,data,tag] = token.split(".");
    // Reject non-canonical encodings, including changes only in unused base64 bits.
    const decode = (s: string) => { const b = Buffer.from(s,"base64url"); if (b.toString("base64url") !== s) throw new Error(); return b; };
    const decipher = createDecipheriv("aes-256-gcm", key, decode(iv));
    decipher.setAAD(AAD); decipher.setAuthTag(decode(tag));
    const dartKey = Buffer.concat([decipher.update(decode(data)), decipher.final()]).toString("utf8");
    return validDartKey(dartKey) ? dartKey : null;
  } catch { return null; }
};

/** Each authenticated ciphertext carries its user's key. Never fall back to an operator key. */
export function registerUserAgentRoutes(app: Pick<Express, "get" | "post">, ask: (question: string, dartKey: string) => Promise<unknown>, now: () => number = Date.now) {
  const attempts = new Map<string, { count: number; expiresAt: number }>();
  const limit = (ip: string, kind: string, max: number) => {
    for (const [id, bucket] of attempts) if (bucket.expiresAt <= now()) attempts.delete(id);
    const id = `${kind}:${ip}`;
    let bucket = attempts.get(id);
    if (!bucket) { if (attempts.size >= 2048) return false; bucket = { count: 0, expiresAt: now()+60_000 }; attempts.set(id,bucket); }
    return ++bucket.count <= max;
  };
  const unavailable = (res: Response) => res.status(503).json({found:false,code:"CONNECTION_NOT_CONFIGURED",message:"관리자가 Render 환경변수 AGENT_CONNECTION_SECRET에 32자 이상의 무작위 비밀값을 한 번 설정해야 합니다. 이후 같은 값을 유지하세요."});
  app.get("/api/agent/health", (_req, res) => {
    const configured = !!readEncryptionKey();
    res.set("Cache-Control","no-store").status(configured ? 200 : 503).json({status:configured ? "ready" : "configuration_required",mode:"user_dart_key_persistent",endpoint:"/api/agent/query",connectPath:"/agent-connect",connectionExpires:false,operatorKeyRequired:false,encryptionSecretConfigured:configured});
  });
  app.get("/agent-connect", (_req, res) => {
    res.set("Cache-Control","no-store").set("Referrer-Policy","no-referrer").set("X-Content-Type-Options","nosniff").set("Content-Security-Policy","default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'").type("html").send(CONNECT_HTML);
  });
  app.post("/api/agent/session", (req, res) => {
    res.set("Cache-Control","no-store");
    const encryptionKey = readEncryptionKey(); if (!encryptionKey) return unavailable(res);
    if (!limit(req.ip ?? req.socket?.remoteAddress ?? "unknown","issue",20)) return res.status(429).set("Retry-After","60").json({message:"연결 요청이 많습니다. 1분 후 다시 시도해 주세요."});
    const dartKey = typeof req.body?.dartApiKey === "string" ? req.body.dartApiKey.trim() : "";
    if (!validDartKey(dartKey)) return res.status(400).json({message:"본인이 발급받은 OpenDART 인증키 40자리를 입력해 주세요."});
    return res.status(201).json({sessionToken:issueToken(dartKey,encryptionKey),expiresAt:null,message:"만료 없는 연결코드입니다. 안전하게 보관하고 본인의 GPT 대화에 붙여 넣으세요. DART 키의 유효성은 실제 조회 시 확인합니다."});
  });
  // Explicitly reject the old temporary-session revoke route: no false revocation promise.
  app.post("/api/agent/session/revoke", (_req, res) => {
    res.set("Cache-Control","no-store").status(410).json({revoked:false,code:"DART_KEY_ROTATION_REQUIRED",message:"현재 코드는 시간 만료가 없습니다. 완전히 무효화하려면 OpenDART에서 해당 인증키를 폐기·변경하세요. GPT에서 코드를 잊는 것만으로는 무효화되지 않습니다."});
  });
  app.post("/api/agent/query", async (req, res) => {
    res.set("Cache-Control","no-store");
    const encryptionKey = readEncryptionKey(); if (!encryptionKey) return unavailable(res);
    if (!limit(req.ip ?? req.socket?.remoteAddress ?? "unknown","query",60)) return res.status(429).set("Retry-After","60").json({found:false,message:"조회 요청이 많습니다. 1분 후 다시 시도해 주세요."});
    const dartKey = resolveToken(req.body?.sessionToken,encryptionKey);
    if (!dartKey) return res.status(401).json({found:false,code:"CONNECTION_REQUIRED",message:"본인의 연결코드 전체를 확인해 주세요. 이전 1시간짜리 코드는 새 방식과 호환되지 않으므로 /agent-connect에서 새 코드로 한 번 전환해야 합니다. 서버 암호화 비밀값이 변경된 경우에도 새 코드가 필요합니다."});
    const question = req.body?.question;
    if (typeof question !== "string" || question.trim().length < 2 || question.trim().length > 300) return res.status(400).json({found:false,message:"question은 2~300자 문자열이어야 합니다."});
    try { return res.json(await ask(question.trim(),dartKey)); }
    catch { return res.status(502).json({found:false,message:"DART 조회에 실패했습니다. 본인 인증키의 상태·호출 한도 또는 서버 연결 상태를 확인해 주세요. 연결코드의 시간 만료 때문은 아닙니다."}); }
  });
  return () => attempts.clear();
}

const CONNECT_HTML = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DART Navigator · 내 인증키 연결</title><style>
body{margin:0;background:#f4f7f6;color:#102a25;font:16px/1.7 system-ui,sans-serif}main{max-width:560px;margin:6vh auto;padding:28px;background:white;border:1px solid #d9e5e0;border-radius:20px}h1{font-size:26px;line-height:1.35}input,textarea,button{box-sizing:border-box;width:100%;font:inherit;border-radius:10px;padding:12px}input,textarea{border:1px solid #a7beb4}button{margin-top:12px;background:#00634a;color:white;border:0;cursor:pointer}button:disabled{opacity:.5}small{color:#52665e}a{color:#00634a}#message{white-space:pre-wrap}#result[hidden]{display:none}@media(max-width:620px){main{margin:16px;padding:22px}}</style></head><body><main>
<h1>내 DART 인증키로<br>ChatGPT 연결하기</h1>
<p>본인의 OpenDART 인증키로 만료 없는 연결코드를 만듭니다. 한 번 받은 코드를 보관하면 서버가 재시작되어도 재발급 없이 사용할 수 있습니다.</p>
<form id="connect"><label for="key">OpenDART 인증키 40자리</label><input id="key" type="password" autocomplete="off" minlength="40" maxlength="40" required placeholder="본인이 발급받은 인증키"><button id="submit" type="submit">계속 사용할 연결코드 받기</button></form>
<p><a href="https://opendart.fss.or.kr/" target="_blank" rel="noreferrer">OpenDART 인증키 발급 안내</a></p>
<p id="message" role="status"></p><section id="result" hidden><h2>연결코드 보관 후 GPT에 붙여 넣기</h2><textarea id="code" rows="4" readonly aria-label="만료 없는 연결코드"></textarea><button id="copy" type="button">연결코드 복사</button><p><small>만료 시간 없음 · 새 GPT 대화에서는 이 코드를 다시 붙여 넣으면 됩니다. 다시 발급받을 필요는 없습니다. 비밀번호 관리자 등에 보관하세요.</small></p></section>
<p><small>원본 키를 암호화한 코드입니다. 코드 소지자는 본인의 키로 조회할 수 있으므로 비공개로 보관하세요. 입력한 키와 코드를 이 페이지의 브라우저 저장소나 URL에 저장하지 않습니다. 실제 인증 성공 여부는 첫 조회에서 확인합니다.</small></p>
<p><small>사용을 완전히 중단하거나 코드가 노출된 경우 OpenDART에서 원본 인증키를 폐기·변경하세요. 서버 운영자가 암호화 비밀값을 바꾸면 기존 코드도 무효화됩니다.</small></p>
</main><script>
const form=document.getElementById('connect'),key=document.getElementById('key'),message=document.getElementById('message'),result=document.getElementById('result'),code=document.getElementById('code'),submit=document.getElementById('submit');
form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;result.hidden=true;code.value='';message.textContent='연결 중…';try{const response=await fetch('/api/agent/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({dartApiKey:key.value.trim()}),cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.message||'연결에 실패했습니다.');code.value='연결코드: '+data.sessionToken;result.hidden=false;message.textContent=data.message;key.value='';}catch(e){message.textContent=e.message||'서버 연결을 확인해 주세요.';}finally{submit.disabled=false;}});
document.getElementById('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(code.value);message.textContent='복사했습니다. 안전하게 보관하고 본인의 GPT 대화창에 붙여 넣으세요.';}catch{code.focus();code.select();message.textContent='연결코드를 선택한 뒤 복사해 주세요.';}});
</script></body></html>`;
