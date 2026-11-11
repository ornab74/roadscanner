import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanAddress,osmPlaces,censusPlaces} from '../cloudflare/geocode.mjs';
test('unit identifiers are removed for address lookup without inventing unit coordinates',()=>{
 assert.equal(cleanAddress('100 Example Ln, Apt 7, Easley SC 29640'),'100 Example Ln, Easley SC 29640');
 assert.equal(cleanAddress('100 Example Ln #7 Easley SC'),'100 Example Ln Easley SC');
});
test('geocoder results expose mapped, street-only and interpolated precision',()=>{
 const osm=osmPlaces([{lat:'34.8',lon:'-82.6',display_name:'Example street',class:'highway'},{lat:'34.81',lon:'-82.61',display_name:'Mapped house',address:{house_number:'100'}}]);assert.equal(osm[0].precision,'street');assert.equal(osm[1].precision,'mapped_address');
 const census=censusPlaces({result:{addressMatches:[{matchedAddress:'100 EXAMPLE LN',coordinates:{x:-82.6,y:34.8}}]}},true);assert.equal(census[0].precision,'interpolated_address');assert.match(census[0].accuracy_label,/Approximate/);assert.equal(census[0].unit_removed,true);
 assert.deepEqual(censusPlaces({result:{addressMatches:[{matchedAddress:'bad',coordinates:{x:999,y:0}}]}}),[]);
});
