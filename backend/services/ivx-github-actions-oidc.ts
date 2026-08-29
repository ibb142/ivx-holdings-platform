import { createPublicKey, verify as verifySignature } from 'node:crypto';

const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS_URL = `${ISSUER}/.well-known/jwks`;
const AUDIENCE = 'ivx-360-autonomous-recovery';
const REPOSITORY = 'ibb142/ivx-holdings-platform';
const OWNER_ID = '74543014';
const REPOSITORY_ID = '1169662811';
const REF = 'refs/heads/main';
const WORKFLOW_SUFFIXES = [
  '/.github/workflows/ivx-360-early-warning.yml@refs/heads/main',
  '/.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml@refs/heads/main',
  '/.github/workflows/ivx-autonomous-radar-self-heal.yml@refs/heads/main',
  '/.github/workflows/ivx-autonomous-nervous-system.yml@refs/heads/main',
  '/.github/workflows/landing-112-agent-autonomous-qa.yml@refs/heads/main',
  '/.github/workflows/autonomous-internal-external-e2e.yml@refs/heads/main',
  '/.github/workflows/ivx-112-2000h-utilization-sla.yml@refs/heads/main',
] as const;
const CLOCK_SKEW_SECONDS = 60;

export type IVXGitHubOIDCClaims = { iss?: unknown; aud?: unknown; exp?: unknown; nbf?: unknown; repository?: unknown; repository_id?: unknown; repository_owner_id?: unknown; ref?: unknown; workflow_ref?: unknown; event_name?: unknown; sub?: unknown; };
export type IVXGitHubOIDCReason = 'ok'|'missing_token'|'malformed_token'|'invalid_header'|'issuer_mismatch'|'audience_mismatch'|'repository_mismatch'|'repository_id_mismatch'|'owner_id_mismatch'|'ref_mismatch'|'workflow_ref_mismatch'|'event_mismatch'|'expired'|'not_yet_valid'|'subject_mismatch'|'jwks_fetch_failed'|'kid_not_found'|'signature_invalid';
export type IVXGitHubOIDCDiagnostic = { ok:boolean; reason:IVXGitHubOIDCReason; claimShape?:{repository:boolean;repositoryId:boolean;ownerId:boolean;ref:boolean;workflowRef:boolean;eventName:boolean;audience:boolean;} };
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string; kty?: string }; type Jwks={keys?:Jwk[]};
let jwksCache:{value:Jwks;at:number}|null=null; const JWKS_TTL_MS=10*60*1000;
function decodeBase64UrlJson<T>(value:string):T{return JSON.parse(Buffer.from(value,'base64url').toString('utf8')) as T;}
function hasAudience(value:unknown):boolean{return typeof value==='string'?value===AUDIENCE:Array.isArray(value)&&value.some(i=>i===AUDIENCE);}
function claimShape(c:IVXGitHubOIDCClaims){return{repository:typeof c.repository==='string',repositoryId:typeof c.repository_id==='string',ownerId:typeof c.repository_owner_id==='string',ref:typeof c.ref==='string',workflowRef:typeof c.workflow_ref==='string',eventName:typeof c.event_name==='string',audience:typeof c.aud==='string'||Array.isArray(c.aud)}}
function validSubject(value:unknown):boolean{if(typeof value!=='string')return false;return value.startsWith(`repo:${REPOSITORY}:`)||value.startsWith(`repo:ibb142@${OWNER_ID}/ivx-holdings-platform@${REPOSITORY_ID}:`);}
export function diagnoseIVXGitHubOIDCClaims(c:IVXGitHubOIDCClaims,now=Math.floor(Date.now()/1000)):IVXGitHubOIDCDiagnostic{const s=claimShape(c);if(c.iss!==ISSUER)return{ok:false,reason:'issuer_mismatch',claimShape:s};if(!hasAudience(c.aud))return{ok:false,reason:'audience_mismatch',claimShape:s};if(c.repository!==REPOSITORY)return{ok:false,reason:'repository_mismatch',claimShape:s};if(typeof c.repository_id==='string'&&c.repository_id!==REPOSITORY_ID)return{ok:false,reason:'repository_id_mismatch',claimShape:s};if(typeof c.repository_owner_id==='string'&&c.repository_owner_id!==OWNER_ID)return{ok:false,reason:'owner_id_mismatch',claimShape:s};if(c.ref!==REF)return{ok:false,reason:'ref_mismatch',claimShape:s};const workflowRef=c.workflow_ref;if(typeof workflowRef!=='string'||!WORKFLOW_SUFFIXES.some(x=>workflowRef.endsWith(x)))return{ok:false,reason:'workflow_ref_mismatch',claimShape:s};if(!['push','schedule','workflow_dispatch','workflow_run'].includes(String(c.event_name)))return{ok:false,reason:'event_mismatch',claimShape:s};if(typeof c.exp!=='number'||c.exp+CLOCK_SKEW_SECONDS<now)return{ok:false,reason:'expired',claimShape:s};if(typeof c.nbf==='number'&&c.nbf-CLOCK_SKEW_SECONDS>now)return{ok:false,reason:'not_yet_valid',claimShape:s};if(!validSubject(c.sub))return{ok:false,reason:'subject_mismatch',claimShape:s};return{ok:true,reason:'ok',claimShape:s};}
export function validateIVXGitHubOIDCClaims(c:IVXGitHubOIDCClaims,n=Math.floor(Date.now()/1000)){return diagnoseIVXGitHubOIDCClaims(c,n).ok;}
async function loadJwks():Promise<Jwks>{const n=Date.now();if(jwksCache&&n-jwksCache.at<JWKS_TTL_MS)return jwksCache.value;const r=await fetch(JWKS_URL,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(5000)});if(!r.ok)throw new Error(`HTTP_${r.status}`);const v=await r.json() as Jwks;if(!Array.isArray(v.keys)||!v.keys.length)throw new Error('EMPTY_JWKS');jwksCache={value:v,at:n};return v;}
export async function diagnoseIVXGitHubActionsOIDCToken(token:string):Promise<IVXGitHubOIDCDiagnostic>{const compact=token.trim();if(!compact)return{ok:false,reason:'missing_token'};const p=compact.split('.');if(p.length!==3)return{ok:false,reason:'malformed_token'};let h:{alg?:unknown;kid?:unknown};let c:IVXGitHubOIDCClaims;try{h=decodeBase64UrlJson(p[0]);c=decodeBase64UrlJson(p[1]);}catch{return{ok:false,reason:'malformed_token'}}if(h.alg!=='RS256'||typeof h.kid!=='string'||!h.kid)return{ok:false,reason:'invalid_header',claimShape:claimShape(c)};const d=diagnoseIVXGitHubOIDCClaims(c);if(!d.ok)return d;let j:Jwks;try{j=await loadJwks()}catch{return{ok:false,reason:'jwks_fetch_failed',claimShape:claimShape(c)}}const k=j.keys?.find(i=>i.kid===h.kid&&i.kty==='RSA');if(!k)return{ok:false,reason:'kid_not_found',claimShape:claimShape(c)};try{const key=createPublicKey({key:k,format:'jwk'});const valid=verifySignature('RSA-SHA256',Buffer.from(`${p[0]}.${p[1]}`,'utf8'),key,Buffer.from(p[2],'base64url'));return valid?{ok:true,reason:'ok',claimShape:claimShape(c)}:{ok:false,reason:'signature_invalid',claimShape:claimShape(c)}}catch{return{ok:false,reason:'signature_invalid',claimShape:claimShape(c)}}}
export async function verifyIVXGitHubActionsOIDCToken(t:string){return(await diagnoseIVXGitHubActionsOIDCToken(t)).ok;}
export async function diagnoseIVXGitHubActionsOIDCRequest(request:Request){return diagnoseIVXGitHubActionsOIDCToken(request.headers.get('X-IVX-GitHub-OIDC')?.trim()??'');}
export async function verifyIVXGitHubActionsOIDCRequest(request:Request){return(await diagnoseIVXGitHubActionsOIDCRequest(request)).ok;}
export const IVX_GITHUB_OIDC_CONTRACT=Object.freeze({issuer:ISSUER,audience:AUDIENCE,repository:REPOSITORY,repositoryId:REPOSITORY_ID,ownerId:OWNER_ID,ref:REF,workflows:['.github/workflows/ivx-360-early-warning.yml','.github/workflows/ivx-112-exact-sha-autodeploy-cert.yml','.github/workflows/ivx-autonomous-radar-self-heal.yml','.github/workflows/ivx-autonomous-nervous-system.yml','.github/workflows/landing-112-agent-autonomous-qa.yml','.github/workflows/autonomous-internal-external-e2e.yml','.github/workflows/ivx-112-2000h-utilization-sla.yml']});