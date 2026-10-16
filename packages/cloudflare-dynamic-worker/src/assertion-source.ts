// Trusted tool source as TEXT. Never import/evaluate this assertion engine in the host.
export const assertionRuntimeSource = String.raw`
import {chai,JestChaiExpect} from '@vitest/expect';
chai.use(JestChaiExpect);
const Reply=Response, stringify=JSON.stringify, freeze=Object.freeze;
export async function run(test){
 let assertions=0, open=true;
 const expect=actual=>{
  const method=(negate,name)=>expected=>{
   if(!open||++assertions>64)throw Error('Assertion limit');
   const value=chai.expect(actual);return(negate?value.not:value)[name](expected);
  };
  return freeze({toBe:method(false,'toBe'),toEqual:method(false,'toEqual'),
    not:freeze({toBe:method(true,'toBe'),toEqual:method(true,'toEqual')})});
 };
 try{
  if(typeof test!=='function')throw Error('Test export required');
  await test(expect);if(assertions===0)throw Error('At least one assertion required');
  open=false;return new Reply(stringify({passed:true,assertions}),{headers:{'content-type':'application/json'}});
 }catch(e){open=false;return new Reply(stringify({passed:false,assertions:assertions>64?64:assertions,
  failure:e?.name==='AssertionError'?'assertion':'execution'}),{headers:{'content-type':'application/json'}});}
}`
