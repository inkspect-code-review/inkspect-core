export type RelevanceSample = {questionId:string;documentId:string;relevant:boolean;score:number;split:"calibration"|"validation"};
export function relevanceMetrics(samples: RelevanceSample[], threshold: number) {
  let truePositive=0,falsePositive=0,trueNegative=0,falseNegative=0;
  for(const sample of samples) {
    if(sample.score>=threshold) { if(sample.relevant)truePositive++;else falsePositive++; }
    else if(sample.relevant)falseNegative++;else trueNegative++;
  }
  const precision=truePositive+falsePositive ? truePositive/(truePositive+falsePositive) : 0;
  const recall=truePositive+falseNegative ? truePositive/(truePositive+falseNegative) : 0;
  const fHalf=precision+recall ? 1.25*precision*recall/(.25*precision+recall) : 0;
  return {threshold,truePositive,falsePositive,trueNegative,falseNegative,precision,recall,fHalf};
}
// Predeclared objective: at least 95% precision and 50% recall on calibration,
// maximize F0.5 (precision weighted twice as strongly), ties prefer higher cutoff.
// Held-out labels MUST NOT select or tune the threshold.
export function calibrateRelevance(samples: RelevanceSample[]) {
  const training=samples.filter(sample=>sample.split==="calibration");
  const choices=Array.from({length:99},(_,index)=>relevanceMetrics(training,(index+1)/100));
  const ranked=choices.filter(choice=>choice.precision>=.95 && choice.recall>=.5)
    .sort((a,b)=>b.fHalf-a.fHalf || b.threshold-a.threshold);
  return {selected:ranked[0] ?? null,choices};
}
