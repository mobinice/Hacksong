const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('assets/youan-p0.js','utf8');
const evaluator=source.slice(source.indexOf('  function evaluate(s,r){'),source.indexOf('  function recalc('));
const ctx={data:{count:10},required:{},operatorLabels:{gt:'>',gte:'>=',lt:'<',lte:'<=',eq:'='},label:k=>k,display:String};
ctx.val=(_,k)=>ctx.data[k];ctx.ruleKeys=r=>[r.fieldKey];vm.createContext(ctx);vm.runInContext(evaluator,ctx);
const base={id:'custom-1',kind:'field-comparison',fieldKey:'count',name:'test',enabled:true,weight:5,threshold:10};
for(const [operator,want] of Object.entries({gt:0,gte:5,lt:0,lte:5,eq:5})){assert.equal(ctx.evaluate({id:1},{...base,operator}).contribution,want);}
assert.equal(ctx.evaluate({id:1},{...base,operator:'gt',threshold:9}).contribution,5);
assert.equal(ctx.evaluate({id:1},{...base,enabled:false,operator:'eq'}).contribution,0);
delete ctx.data.count;const missing=ctx.evaluate({id:1},{...base,operator:'gt'});assert.equal(missing.contribution,0);assert.equal(missing.missing[0],'count');
ctx.data.count='not a number';assert.equal(ctx.evaluate({id:1},{...base,operator:'gt'}).contribution,0);
console.log('Custom comparisons: boundary, missing, invalid and disabled cases passed');
