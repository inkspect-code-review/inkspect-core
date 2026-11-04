import assert from "node:assert/strict";
import { constants, createDecipheriv, generateKeyPairSync, privateDecrypt } from "node:crypto";
import test from "node:test";
import { credentialAAD, encryptCredential } from "../../src/lib/byok/encryption";

test("BYOK envelope authenticates workspace, credential, provider and model; uses randomized encryption",()=>{
  const pair=generateKeyPairSync("rsa",{modulusLength:3072});
  const identity={organization:"org",id:"550e8400-e29b-41d4-a716-446655440000",provider:"openai",model:"gpt-6.1-sol"};
  const secret="synthetic-provider-key-do-not-use";
  const envelope=encryptCredential(secret,identity,pair.publicKey);
  assert.ok(!JSON.stringify(envelope).includes(secret));
  assert.notEqual(encryptCredential(secret,identity,pair.publicKey).ciphertext,envelope.ciphertext);
  const aad=credentialAAD(identity);
  const dataKey=privateDecrypt({key:pair.privateKey,oaepHash:"sha256",oaepLabel:aad,padding:constants.RSA_PKCS1_OAEP_PADDING},Buffer.from(envelope.wrapped_key,"base64"));
  const decode=(aad:Buffer,tag:string)=>{
    const decipher=createDecipheriv("aes-256-gcm",dataKey,Buffer.from(envelope.nonce,"base64"));
    decipher.setAAD(aad);decipher.setAuthTag(Buffer.from(tag,"base64"));
    return Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,"base64")),decipher.final()]).toString();
  };
  assert.equal(decode(aad,envelope.tag),secret);
  for(const field of ["organization","id","provider","model"])assert.throws(()=>decode(credentialAAD({...identity,[field]:"other"}),envelope.tag));
  assert.throws(()=>decode(aad,Buffer.alloc(16).toString("base64")));
  assert.throws(()=>encryptCredential("bad\nheader-value",identity,pair.publicKey));
  dataKey.fill(0);
});
