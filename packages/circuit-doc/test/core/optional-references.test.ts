import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicationPolicy, FIELD_KEYS, type InstanceSelection, type PublicationMatrix} from '../../src/core/publication.ts';
import {createComponentReferencesDescriptor, encodeComponentReferencesDescriptor, decodeComponentReferencesDescriptor, MODEL_UNAVAILABLE_TEXT} from '../../src/core/reference-descriptor.ts';
import {checkRecordPage} from '../../src/scan/built-references.ts';
import {bundleForSsr} from '../ui/bundle.ts';
const policy = Object.fromEntries(FIELD_KEYS.map(key => [key, 'PUBLISH'])) as PublicationMatrix;
const selection = (kind: InstanceSelection['documentSelections'][number]['documentKind'] = 'source-record'): InstanceSelection => ({recordIds:['record'], sourceIds:['source'], linkableSourceIds:['source'], documentSelections:[{recordId:'record',sourceId:'source',documentKind:kind}], expect:{records:1,sources:1,integrationRules:0,packages:1}});
const input = {document:{label:'Source record',title:'Project source; exact manufacturer datasheet unavailable',authority:'PROJECT_GENERATOR',availability:'AVAILABLE',url:'https://example.org/evidence.json'},footprintName:'PKG-FIXTURE',model:null};
test('source-record and old PDF kinds require explicit selected linkable source',()=>{
 for(const kind of ['source-record','datasheet','specification','drawing'] as const) assert.doesNotThrow(()=>new PublicationPolicy(policy,selection(kind)));
 assert.throws(()=>new PublicationPolicy(policy,{...selection(),documentSelections:[]}));
 assert.throws(()=>new PublicationPolicy(policy,{...selection(),linkableSourceIds:[]}));
});
test('generic label retains source authority and cannot permit unsafe URL or arbitrary label',()=>{
 const descriptor=createComponentReferencesDescriptor(input);
 assert.deepEqual(decodeComponentReferencesDescriptor(encodeComponentReferencesDescriptor(descriptor)),descriptor);
 assert.equal(descriptor.modelDescriptor,null);
 for(const value of [{...descriptor,document:{...descriptor.document,url:'javascript:alert(1)'}},{...descriptor,document:{...descriptor.document,label:'Manufacturer qualified'}}]) assert.throws(()=>encodeComponentReferencesDescriptor(value));
 assert.throws(()=>encodeComponentReferencesDescriptor({...descriptor,modelDescriptor:undefined} as unknown as typeof descriptor));
});
const ui = await bundleForSsr<typeof import('../../src/ui/index.ts')>('src/ui/index.ts');
function html() {return ui.renderToString(ui.h(ui.ComponentReferences,{descriptor:encodeComponentReferencesDescriptor(createComponentReferencesDescriptor(input))}))+'<div class="zcd-evidence-table"></div>';}
test('SSR and built checker keep footprint and visible absent-model statement without a viewer',()=>{
 const page=html();assert.ok(page.includes(MODEL_UNAVAILABLE_TEXT));assert.doesNotMatch(page,/data-model-url/);
 const footprints=new Set<string>(),models=new Set<string>();checkRecordPage('part',page,footprints,models,false);
 assert.deepEqual([...footprints],['PKG-FIXTURE.svg']);assert.equal(models.size,0);
});
test('absent-model built checker rejects missing notice, invented viewer and missing footprint',()=>{
 for(const page of [html().replace(MODEL_UNAVAILABLE_TEXT,'Qualified'),html().replace('data-model-unavailable','data-model-url'),html().replace(/<img\b[^>]*>/u,'')]) assert.throws(()=>checkRecordPage('part',page,new Set(),new Set(),false));
});
