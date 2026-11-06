import { transform } from 'esbuild';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const {code}=await transform(await readFile(new URL('../src/tournament.ts',import.meta.url),'utf8'),{loader:'ts',format:'esm'});
const {bracketGraph,roundRobin}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
for(let count=2;count<=128;count++){
 const entrants=Array.from({length:count},(_,i)=>String(i));
 assert.equal(roundRobin(entrants).length,count*(count-1)/2);
 for(const double of [false,true])for(let trial=0;trial<5;trial++){
  const graph=bracketGraph(entrants,double);const results=new Map();const losses=new Map(entrants.map(x=>[x,0]));
  for(const node of graph.nodes){
   const resolve=src=>'seed'in src?entrants[src.seed]??null:results.get(src.match)[src.outcome];
   let left=resolve(node.left),right=resolve(node.right);
   if(node.reset&&results.get('GF').side==='left'){results.set(node.key,{winner:results.get('GF').winner,loser:null});continue;}
   assert.notEqual(left&&right&&left===right,true,'no self-pairing');
   if(!left||!right){results.set(node.key,{winner:left??right,loser:null});continue;}
   assert.ok(losses.get(left)<(double?2:1));assert.ok(losses.get(right)<(double?2:1));
   // Alternate outcomes deterministically, including grand-final reset cases.
   const side=(trial+node.key.length+Number(left))%2?'left':'right';const winner=side==='left'?left:right;const loser=side==='left'?right:left;
   losses.set(loser,losses.get(loser)+1);results.set(node.key,{winner,loser,side});
  }
  const champion=results.get(double?'RESET':`W${Math.ceil(Math.log2(count))}.0`).winner;
  for(const [id,n] of losses)assert.equal(id===champion?n<(double?2:1):n===(double?2:1),true,`count=${count},double=${double}, entrant=${id},losses=${n}`);
 }
}
console.log('PASS: round robin and single/double elimination, 2–128 entrants, byes, resets and elimination counts.');
