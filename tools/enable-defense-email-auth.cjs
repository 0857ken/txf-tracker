'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {GoogleAuth}=req('google-auth-library');

async function main(){
  const credentials=JSON.parse(process.env.FIREBASE_KEY||'{}');
  if(credentials.project_id!=='txf-tracker') throw new Error('WRONG_PROJECT');
  const auth=new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/cloud-platform']});
  const client=await auth.getClient(), rawHeaders=await client.getRequestHeaders();
  const headers=typeof rawHeaders.entries==='function'?Object.fromEntries(rawHeaders.entries()):Object.fromEntries(Object.entries(rawHeaders));
  const url='https://identitytoolkit.googleapis.com/admin/v2/projects/txf-tracker/config';
  const before=await fetch(url,{headers});
  if(!before.ok) throw new Error('AUTH_CONFIG_READ_'+before.status);
  const current=await before.json();
  const domains=[...new Set([...(current.authorizedDomains||[]),'0857ken.github.io'])];
  const body={authorizedDomains:domains,signIn:{email:{enabled:true,passwordRequired:true}}};
  const r=await fetch(url+'?updateMask=authorizedDomains,signIn.email',{
    method:'PATCH',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)
  });
  if(!r.ok) throw new Error('AUTH_CONFIG_UPDATE_'+r.status);
  const after=await r.json();
  const ok=after.signIn?.email?.enabled===true && after.signIn?.email?.passwordRequired===true &&
    (after.authorizedDomains||[]).includes('0857ken.github.io');
  console.log(JSON.stringify({emailEnabled:after.signIn?.email?.enabled??null,passwordRequired:after.signIn?.email?.passwordRequired??null,
    githubPagesAuthorized:(after.authorizedDomains||[]).includes('0857ken.github.io'),anonymousPreserved:after.signIn?.anonymous?.enabled??null}));
  if(!ok) throw new Error('AUTH_CONFIG_VERIFY_FAILED');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
