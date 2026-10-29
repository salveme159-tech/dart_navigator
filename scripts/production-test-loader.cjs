// Test-only TypeScript loader. Production modules execute; only external providers/env are isolated.
const fs=require('node:fs'),path=require('node:path');
const ts=require(process.env.TS_COMPILER_PATH || 'typescript');
module.exports=function createLoader(root,overrides={}){
 const unavailable=async()=>null;
 const stubs={
  '@trpc/server':{TRPCError:class extends Error{constructor(o){super(o.message);this.code=o.code;}}},
  env:{ENV:{opendartApiKey:'a'.repeat(40)}},
  apiBase:{apiBaseUrl:'',apiUrl:route=>route},
  crossValidation:{crossValidateMetric:async()=>({providers:[],status:'UNAVAILABLE'}),crossValidateMetrics:async()=>({}),clearCrossValidationCache:()=>{},fetchNaverDebtFallback:unavailable},
  fnGuideFallback:{fetchFnGuideFallback:unavailable,fetchFnGuideLeaseLiabilities:unavailable},
  disclosureNotes:{parseDepreciationFromDisclosure:()=>null,parseLeaseLiabilitiesFromDisclosure:()=>null,parseBorrowingTotalFromDisclosure:()=>null},
  ...overrides,
 };
 const cache=new Map();
 function load(file){
  file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;
  const mod={exports:{}};cache.set(file,mod);
  let code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  const req=id=>{if(stubs[id])return stubs[id];if(id.endsWith('/env'))return stubs.env;if(id.endsWith('/apiBase'))return stubs.apiBase;for(const name of ['crossValidation','fnGuideFallback','disclosureNotes'])if(id.endsWith('/'+name))return stubs[name];if(id.startsWith('@shared/'))return load(path.join(root,'shared',id.slice(8)+'.ts'));if(!id.startsWith('.'))return require(id);return load(path.resolve(path.dirname(file),id.endsWith('.ts')?id:id+'.ts'));};
  // Access private timeout transport only in the test loader, never in production exports.
  if(file.endsWith('/server/dart/client.ts'))code+='\nexports.__transport=dartFetch;';
  new Function('require','module','exports',code)(req,mod,mod.exports);return mod.exports;
 }
 return load;
};
