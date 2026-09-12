const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function load(official){
  const calls=[];
  const context={URL,URLSearchParams,structuredClone,location:{href:'https://static.example/preview.html'+(official?'?dataset=official':''),search:official?'?dataset=official':''},API_BASE:'https://api.example',fetch:(url)=>{calls.push(url);return Promise.resolve({});}};
  context.window=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync('assets/official-config.js','utf8'),context);
  return {context,calls};
}
test('official mode routes S3 requests to API host and isolates storage',async()=>{
  const {context,calls}=load(true);
  await context.fetch('/api/storage/state');
  await context.fetch('/api/workspace');
  assert.equal(calls[0],'https://api.example/api/storage/state?workspace=official');
  assert.equal(calls[1],'https://api.example/api/workspace');
});
test('original mode retains fetch and original local storage key',async()=>{
  const {context,calls}=load(false);await context.fetch('/api/storage/state');
  assert.equal(calls[0],'/api/storage/state');assert.equal(context.workspaceStorageKey,'youan-demo-v2');
});
test('official snapshots are not duplicated into persisted user state',()=>{
  const {context}=load(true);
  const db={reviews:{7:{note:'keep'}},p0:{data:{7:{snapshot:{capacity:{chosen:'official-7-capacity',candidates:[{id:'official-7-capacity',value:75,sourceKind:'official'}]},studentCount:{chosen:'upload',candidates:[{id:'upload',value:70,sourceKind:'user'}]}}}},assessments:{7:{score:0}}}};
  const saved=JSON.parse(context.workspaceSerialize(db));
  assert.equal(saved.reviews[7].note,'keep');
  assert.equal(saved.p0.data[7].snapshot.capacity,undefined);
  assert.equal(saved.p0.data[7].snapshot.studentCount.candidates[0].value,70);
  assert.equal(db.p0.data[7].snapshot.capacity.candidates.length,1);
});
