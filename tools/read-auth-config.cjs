'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {GoogleAuth}=req('google-auth-library');
async function main(){
  const credentials=JSON.parse(process.env.FIREBASE_KEY||'{}');
  if(credentials.project_id!=='txf-tracker') throw new Error('WRONG_PROJECT');
  const auth=new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/cloud-platform']});
  const client=await auth.getClient(),headers=await client.getRequestHeaders();
  const r=await fetch('https://identitytoolkit.googleapis.com/admin/v2/projects/txf-tracker/config',{headers});
  if(!r.ok) throw new Error('AUTH_CONFIG_READ_'+r.status);
  const j=await r.json();
  const providers=(j.signIn?.hashConfig?[]:[]);
  console.log(JSON.stringify({
    anonymous:j.signIn?.anonymous?.enabled??null,
    email:j.signIn?.email?.enabled??null,
    emailPasswordRequired:j.signIn?.email?.passwordRequired??null,
    authorizedDomains:j.authorizedDomains||[],
    hasSmsConfig:Boolean(j.smsRegionConfig),
    providerInfo:(j.signIn?.providerInfo||[]).map(x=>({providerId:x.providerId,enabled:x.enabled}))
  }));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
