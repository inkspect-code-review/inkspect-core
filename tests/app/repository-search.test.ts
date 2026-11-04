import assert from "node:assert/strict";
import test from "node:test";
import { searchByText, searchRepositories } from "../../src/lib/repository-search";

test("repository search reaches entries past the render limit and combines owner/name terms",()=>{
  const repositories=Array.from({length:10000},(_,i)=>({id:i,fullName:`team/project-${i}`}));
  assert.equal(searchRepositories(repositories,"").matches.length,80);
  assert.equal(searchRepositories(repositories,"").total,10000);
  assert.deepEqual(searchRepositories(repositories,"TEAM 9999").matches,[repositories[9999]]);
  assert.equal(searchRepositories(repositories,"missing").total,0);
  assert.deepEqual(searchRepositories([{id:1,fullName:"örg/répo"}],"org repo").matches.map(r=>r.id),[1]);
});

test("text search keeps option order, caps rendered matches and still counts every match",()=>{
  const options=[{value:"workspace",label:"Workspace-wide request"},...Array.from({length:500},(_,i)=>({value:String(i),label:`acme/service-${i}`}))];
  const all=searchByText(options,"",option=>option.label,80);
  assert.equal(all.matches[0].value,"workspace");
  assert.deepEqual([all.matches.length,all.total],[80,501]);
  const narrowed=searchByText(options,"service-49",option=>option.label,80);
  assert.deepEqual(narrowed.matches.map(option=>option.value),["49","490","491","492","493","494","495","496","497","498","499"]);
  assert.equal(searchByText(options,"workspace",option=>option.label,80).matches[0].value,"workspace");
});
