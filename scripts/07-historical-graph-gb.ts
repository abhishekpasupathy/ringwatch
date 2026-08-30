import prisma from "../lib/db";
import { buildGraph, percentile99 } from "../lib/graph-builder";
import { buildAccountGraphFeatures, type AccountGraphFeatures } from "../lib/account-graph-features";
import { chooseThreshold } from "../lib/ml-detector";
import { predictGradientProbabilities, trainGradientBoosting } from "../lib/gradient-boosting-detector";

interface Behavior { tx:number; inTx:number; outTx:number; received:number; sent:number; counterparties:Set<string>; formats:Set<string>; }
const empty=():Behavior=>({tx:0,inTx:0,outTx:0,received:0,sent:0,counterparties:new Set(),formats:new Set()});
function behavior(ts:{fromAccountId:string;toAccountId:string;amountPaid:number;amountReceived:number;paymentFormat:string}[]){const m=new Map<string,Behavior>();for(const t of ts){const a=m.get(t.fromAccountId)??empty(),b=m.get(t.toAccountId)??empty();a.tx++;a.outTx++;a.sent+=t.amountPaid;a.counterparties.add(t.toAccountId);a.formats.add(t.paymentFormat);b.tx++;b.inTx++;b.received+=t.amountReceived;b.counterparties.add(t.fromAccountId);b.formats.add(t.paymentFormat);m.set(t.fromAccountId,a);m.set(t.toAccountId,b);}return m;}
const fallback:AccountGraphFeatures={inDegree:0,outDegree:0,totalDegree:0,communitySize:1,communityDensity:0,communityTriangleCount:0,inOutAmountRatio:0};
function vector(b:Behavior,g:AccountGraphFeatures){return[Math.log1p(b.tx),Math.log1p(b.inTx),Math.log1p(b.outTx),Math.log1p(b.received),Math.log1p(b.sent),Math.log1p(b.counterparties.size),Math.log1p(b.formats.size),Math.log1p(g.inDegree),Math.log1p(g.outDegree),Math.log1p(g.totalDegree),Math.log1p(g.communitySize),g.communityDensity,Math.log1p(g.communityTriangleCount),g.inOutAmountRatio];}
function metrics(p:number[],l:number[],t:number){let tp=0,fp=0,fn=0,tn=0;for(let i=0;i<l.length;i++){const y=p[i]>=t;if(y&&l[i]===1)tp++;else if(y&&l[i]===0)fp++;else if(!y&&l[i]===1)fn++;else tn++;}const precision=tp+fp?tp/(tp+fp):0,recall=tp+fn?tp/(tp+fn):0,f1=precision+recall?2*precision*recall/(precision+recall):0;return{tp,fp,fn,tn,precision,recall,f1};}
function sampleNegatives(xs:{features:number[];label:number}[],ratio:number){const p=xs.filter(x=>x.label===1),n=xs.filter(x=>x.label===0),limit=Math.max(1,p.length*ratio),stride=Math.max(1,Math.ceil(n.length/limit));return[...p,...n.filter((_,i)=>i%stride===0).slice(0,limit)];}
async function main(){
 console.log("══════════════════════════════════════════");console.log(" RingWatch — Stage 7: Historical Graph + Gradient Boosting");console.log("══════════════════════════════════════════\n");
 const select={fromAccountId:true,toAccountId:true,amountPaid:true,amountReceived:true,paymentFormat:true,isLaunderingLabel:true} as const;
 const train=await prisma.transaction.findMany({where:{split:"TRAIN"},select});const test=await prisma.transaction.findMany({where:{split:"TEST"},select});
 console.log(` TRAIN transactions: ${train.length.toLocaleString()}`);console.log(` TEST transactions:  ${test.length.toLocaleString()}`);
 const trainLabels=new Set<string>(),testLabels=new Set<string>();for(const t of train)if(t.isLaunderingLabel){trainLabels.add(t.fromAccountId);trainLabels.add(t.toAccountId);}for(const t of test)if(t.isLaunderingLabel){testLabels.add(t.fromAccountId);testLabels.add(t.toAccountId);}
 console.log("\nBuilding ONE historical graph from TRAIN only...");const gd=buildGraph(train,percentile99(train.map(t=>t.amountPaid)));const gf=buildAccountGraphFeatures(train,gd.communities);console.log(` TRAIN communities: ${new Set(Object.values(gd.communities)).size.toLocaleString()}`);
 const tb=behavior(train),vb=behavior(test);const trainAll=Array.from(tb.entries()).map(([id,b])=>({features:vector(b,gf.get(id)??fallback),label:trainLabels.has(id)?1:0}));const sampled=sampleNegatives(trainAll,20);
 console.log(` TRAIN accounts: ${trainAll.length.toLocaleString()}`);console.log(` Training sample: ${sampled.length.toLocaleString()} (${sampled.filter(x=>x.label===1).length} positive, ${sampled.filter(x=>x.label===0).length} negative)`);
 console.log("\nTraining gradient-boosted trees...");const model=trainGradientBoosting(sampled.map(x=>x.features),sampled.map(x=>x.label),{nEstimators:80,learningRate:0.04,maxDepth:3,subsample:0.8,maxFeatures:"sqrt",randomState:42});
 const trainP=predictGradientProbabilities(model,sampled.map(x=>x.features));const selected=chooseThreshold(trainP,sampled.map(x=>x.label as 0|1));console.log(` Selected threshold from TRAIN: ${selected.threshold.toFixed(2)}`);console.log(` TRAIN sample F1: ${(selected.f1*100).toFixed(2)}%`);
 // Crucial: structural features for TEST come from TRAIN history. Only TEST-period behavior is observed for the prediction.
 const testRows=Array.from(vb.entries()).map(([id,b])=>({features:vector(b,gf.get(id)??fallback),label:testLabels.has(id)?1:0}));const testP=predictGradientProbabilities(model,testRows.map(x=>x.features));const r=metrics(testP,testRows.map(x=>x.label),selected.threshold);
 console.log("\n════════ TEST SET (HELD OUT) ════════");console.log(` TP: ${r.tp}`);console.log(` FP: ${r.fp}`);console.log(` FN: ${r.fn}`);console.log(` TN: ${r.tn}`);console.log(` Precision: ${(r.precision*100).toFixed(2)}%`);console.log(` Recall:    ${(r.recall*100).toFixed(2)}%`);console.log(` F1:        ${(r.f1*100).toFixed(2)}%`);console.log("\nStage 7 complete: no TEST graph was built and TEST labels were not used for training/threshold selection.");await prisma.$disconnect();
}
main().catch(e=>{console.error(e);prisma.$disconnect();process.exit(1);});
