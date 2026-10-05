'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
const req=createRequire(path.resolve('prod/tools/defense-runner/package.json'));
const {GoogleAuth}=req('google-auth-library');

async function main(){
  if(!process.env.FIREBASE_KEY) throw new Error('CREDENTIAL_UNAVAILABLE');
  const credentials=JSON.parse(process.env.FIREBASE_KEY);
  if(credentials.project_id!=='txf-tracker') throw new Error('WRONG_PROJECT');
  const auth=new GoogleAuth({credentials,scopes:['https://www.googleapis.com/auth/cloud-platform']});
  const client=await auth.getClient();
  const headers=await client.getRequestHeaders();
  const release=await fetch('https://firebaserules.googleapis.com/v1/projects/txf-tracker/releases/cloud.firestore',{headers});
  if(!release.ok) throw new Error('RULE_RELEASE_READ_'+release.status);
  const rel=await release.json();
  const ruleset=await fetch('https://firebaserules.googleapis.com/v1/'+rel.rulesetName,{headers});
  if(!ruleset.ok) throw new Error('RULESET_READ_'+ruleset.status);
  const body=await ruleset.json();
  for(const f of body.source?.files||[]){
    console.log('=== FIRESTORE RULE FILE: '+(f.name||'unnamed')+' ===');
    console.log(f.content||'');
  }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
