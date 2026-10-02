import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveRepresentatives} from '../../src/browser-smoke/representatives.ts';
import {deriveRepresentatives} from '../../src/browser-smoke/derive-representatives.ts';
import {inspectReferencePage} from '../../src/browser-smoke/checks/reference-page.ts';
import type {CdpClient} from '../../src/browser-smoke/cdp.ts';
import {MODEL_UNAVAILABLE_TEXT, createComponentReferencesDescriptor, encodeComponentReferencesDescriptor} from '../../src/core/reference-descriptor.ts';
import {writePreflight, writeRecordPage} from './derived-fixture.ts';
test('footprint-only pages remain checked but cannot be the model-interaction representative',async t=>{
 const root=await mkdtemp(join(tmpdir(),'optional-reps-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const [slug,content] of [['absent','<section class="zcd-component-references"><p data-model-unavailable="true"></p></section>'],['present','<section class="zcd-component-references"></section>']] as const){await mkdir(join(root,slug));await writeFile(join(root,slug,'index.html'),content);}
 const reps=['absent','present'].map(slug=>({kind:slug,path:`/${slug}/`,slug,identity:slug}));const result=await resolveRepresentatives(root,reps);
 assert.deepEqual(result.withReferences,reps);assert.equal(result.record,reps[1]);assert.equal((await resolveRepresentatives(root,reps.slice(0,1))).record,undefined);
});
test('default derivation includes a no-model descriptor',async t=>{
 const root=await mkdtemp(join(tmpdir(),'optional-derive-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paths={preflightFile:join(root,'preflight.json'),generatedRoot:join(root,'generated'),distRoot:join(root,'unbuilt')};
 await writePreflight(paths.preflightFile,['part']);
 const descriptor=encodeComponentReferencesDescriptor(createComponentReferencesDescriptor({document:{label:'Source record',title:'Evidence',authority:'PROJECT_GENERATOR',availability:'AVAILABLE',url:'https://example.org/evidence.json'},footprintName:'PART',model:null}));
 await writeRecordPage(paths.generatedRoot,'part',{identity:'PART',descriptor});
 const result=await deriveRepresentatives(paths);assert.equal(result.outcome,'derived');if(result.outcome==='derived')assert.equal(result.representatives[0]?.slug,'part');
});
test('no-model browser path checks the notice and rejects an invented viewer without waiting for one',async()=>{
 const report={width:390,overflow:false,notice:MODEL_UNAVAILABLE_TEXT,noticeVisible:true,models:0,footprintLoaded:true,label:'Source record',href:'https://example.org/source.json',authority:'PROJECT_GENERATOR',theme:'dark',headingId:'documents',themeSignature:'dark'};
 const cdp:CdpClient={close(){},send:async(method,params)=>{assert.equal(method,'Runtime.evaluate');const expression=String(params?.expression);assert.ok(!expression.includes('data-model-viewer-status'));return {result:{value:expression.includes('noticeVisible:')?report:true}};}};
 const rep={kind:'optional',path:'/optional/',slug:'optional',identity:'OPTIONAL'};
 assert.deepEqual(await inspectReferencePage(cdp,rep,390,'dark',false),{themeSignature:'dark'});report.models=1;await assert.rejects(inspectReferencePage(cdp,rep,390,'dark',false),/no invented model/);
});
test('leading no-model records cannot suppress a later model interaction representative',async t=>{
 const root=await mkdtemp(join(tmpdir(),'optional-derive-model-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paths={preflightFile:join(root,'preflight.json'),generatedRoot:join(root,'generated'),distRoot:join(root,'unbuilt')};
 await writePreflight(paths.preflightFile,['a','b','c','d']);
 const descriptor=encodeComponentReferencesDescriptor(createComponentReferencesDescriptor({document:{label:'Source record',title:'Evidence',authority:'PROJECT_GENERATOR',availability:'AVAILABLE',url:'https://example.org/evidence.json'},footprintName:'PART',model:null}));
 for(const slug of ['a','b','c'])await writeRecordPage(paths.generatedRoot,slug,{identity:slug,descriptor});
 await writeRecordPage(paths.generatedRoot,'d',{identity:'MODEL'});
 const result=await deriveRepresentatives(paths);assert.equal(result.outcome,'derived');if(result.outcome==='derived')assert.deepEqual(result.representatives.map(r=>r.slug),['a','b','d']);
});

const {referenceSmokeSummary} = await import('../../src/browser-smoke/run.ts');
test('browser summary never promotes skipped model gates to PASS',()=>{
 const missing=referenceSmokeSummary(8,8,false);assert.match(missing,/8 component-reference inspections/);assert.match(missing,/no-JS NOT RUN/);assert.doesNotMatch(missing,/no-JS passed/);
 const present=referenceSmokeSummary(16,16,true);assert.match(present,/no-JS passed/);assert.doesNotMatch(present,/NOT RUN/);
});
