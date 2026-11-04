import assert from "node:assert/strict";
import test from "node:test";
import { calibrateRelevance, relevanceMetrics, type RelevanceSample } from "../../src/lib/chat-relevance-metrics";

const sample=(score:number,relevant:boolean,split:RelevanceSample["split"]="calibration"):RelevanceSample=>({questionId:"q",documentId:"d",relevant,score,split});
test("calibration selects on training data alone and gives precision priority",()=>{
  const training=[sample(.6,true),sample(.7,true),sample(.3,false),sample(.2,false)];
  const a=calibrateRelevance(training);
  const b=calibrateRelevance([...training,sample(.001,true,"validation"),sample(.99,false,"validation")]);
  assert.equal(a.selected?.threshold,.6);
  assert.deepEqual(a.selected,b.selected);
  const metrics=relevanceMetrics(training,.6);
  assert.equal(metrics.truePositive,2);assert.equal(metrics.falsePositive,0);assert.equal(metrics.recall,1);
});
test("calibration does not recommend suppressing every source when labels cannot be separated",()=>{
  assert.equal(calibrateRelevance([sample(.1,true),sample(.9,false)]).selected,null);
  assert.equal(calibrateRelevance([]).selected,null);
  assert.equal(relevanceMetrics([sample(.5,true)],.51).precision,0);
});
