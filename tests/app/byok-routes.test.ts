import assert from "node:assert/strict";
import test from "node:test";
import type { Auth } from "../../src/lib/github";
import { handleByokSettings } from "../../src/lib/byok/routes";

test("BYOK settings enforce session, workspace, owner/admin and origin without returning submitted secrets",async()=>{
  let role="member",signedIn=true,saves=0,fail=false;
  const auth={options:{baseURL:"http://localhost:3002"},api:{getSession:async()=>signedIn?{user: { ageConfirmedAt: new Date(), id:"user"},session:{activeOrganizationId:"org"}}:null},$context:Promise.resolve({adapter:{findOne:async()=>role?{role}:null}})} as unknown as Auth;
  const secret="synthetic-api-key-must-not-be-returned";
  const services={setMode:async()=>{saves++;},ready:()=>true,state:async()=>({plan:"cloud",review_provider:"byok",eligible:true,connection:null}),save:async(org:string,user:string,provider:unknown,model:unknown,key:unknown)=>{saves++;assert.equal(org,"org");assert.equal(user,"user");assert.equal(key,secret);if(fail)throw new Error(secret);},remove:async()=>{saves++;}};
  const request=(method="GET",origin="http://localhost:3002",org="org")=>new Request(`http://localhost:3002/api/byok?organizationId=${org}`,{method,headers:{origin,"Content-Type":"application/json"},...(method==="POST"?{body:JSON.stringify({provider:"openai",model:"gpt-6.1-sol",api_key:secret,organizationId:"other"})}:{})});
  assert.equal((await handleByokSettings(request("POST"),auth,services)).status,403);assert.equal(saves,0);
  role="owner";
  assert.equal((await handleByokSettings(request("POST","https://evil.example"),auth,services)).status,403);
  assert.equal((await handleByokSettings(request("POST",undefined,"other"),auth,services)).status,409);
  let result=await handleByokSettings(request("POST"),auth,services);assert.equal(result.status,200);assert.equal((await result.text()).includes(secret),false);
  fail=true;result=await handleByokSettings(request("POST"),auth,services);assert.equal(result.status,503);assert.equal((await result.text()).includes(secret),false);
  role="admin";assert.equal((await handleByokSettings(request("DELETE"),auth,services)).status,200);
  signedIn=false;assert.equal((await handleByokSettings(request(),auth,services)).status,401);
});

test("provider mode changes use the selected edition service and authenticated workspace", async () => {
  const auth = { options: { baseURL: "http://localhost:3002" }, api: { getSession: async () => ({ user: { ageConfirmedAt: new Date(), id: "manager" }, session: { activeOrganizationId: "org" } }) }, $context: Promise.resolve({ adapter: { findOne: async () => ({ role: "owner" }) } }) } as unknown as Auth;
  const changes: unknown[][] = [];
  const services = {
    ready: () => true,
    state: async () => ({ review_provider: "managed", eligible: true, connection: null }),
    save: async () => { assert.fail("Changing provider mode must not save a key"); },
    remove: async () => { assert.fail("Changing provider mode must not delete a key"); },
    setMode: async (...args: unknown[]) => { changes.push(args); },
  };
  const result = await handleByokSettings(new Request("http://localhost:3002/api/byok?organizationId=org", {
    method: "POST", headers: { origin: "http://localhost:3002", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "provider", mode: "managed", organizationId: "other", userId: "other" }),
  }), auth, services);
  assert.equal(result.status, 200);
  assert.deepEqual(changes, [["org", "manager", "managed"]]);
});
