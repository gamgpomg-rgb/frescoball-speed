'use strict';
// 過去の記録：同じ動画は1件にまとめる（見分け方はファイル名＋長さ、両方にサイズがあればサイズも）。
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const a=html.indexOf('function videoKey('),b=html.indexOf('async function readAllRecords()');
const c=vm.createContext({});
vm.runInContext(html.slice(a,b),c);
const rec=(id,over={})=>({id,dateISO:`2026-11-1${id}T10:00:00Z`,fileName:'IMG_1.MOV',duration:60,total:50,...over});
// 解析し直すたびに増えていた3件は、一覧では新しい1件にまとまる（元の記録は消さない）
let r=c.collapseSameVideo([rec(1),rec(2),rec(3)]);
assert.deepEqual(r.recs.map(x=>x.id),[3]);assert.equal(r.counts.get(3),3);assert.deepEqual(r.groups.get(3).map(x=>x.id),[3,2,1],'older analyses stay available, newest first');
// 長さは四捨五入で比べる。違う動画・ライブ・名前なしは混ぜない
assert.equal(c.collapseSameVideo([rec(1,{duration:59.6}),rec(2,{duration:60.2})]).recs.length,1);
assert.equal(c.collapseSameVideo([rec(1),rec(2,{fileName:'IMG_2.MOV'}),rec(3,{duration:75})]).recs.length,3);
assert.equal(c.collapseSameVideo([rec(1,{fileName:'ライブ計測',type:'live'}),rec(2,{fileName:'ライブ計測',type:'live'})]).recs.length,2);
assert.equal(c.collapseSameVideo([rec(1,{fileName:'解析結果'}),rec(2,{fileName:'解析結果'})]).recs.length,2);
// サイズが両方にあって違えば別の動画。片方に無ければ（古い記録）名前と長さだけで同じとみなす
assert.equal(c.collapseSameVideo([rec(1,{fileSize:100}),rec(2,{fileSize:200})]).recs.length,2);
assert.equal(c.collapseSameVideo([rec(1,{fileSize:100}),rec(2,{fileSize:100})]).recs.length,1);
assert.equal(c.collapseSameVideo([rec(1),rec(2,{fileSize:100})]).recs.length,1);
// 新しい順に並ぶ
assert.deepEqual(c.collapseSameVideo([rec(1),rec(2,{fileName:'B.MOV'}),rec(3,{fileName:'C.MOV'})]).recs.map(x=>x.id),[3,2,1]);
// 保存済みの記録は上書きしない：id を引き継ぐ処理が残っていないこと、✕は押した1件だけを消すこと
assert.doesNotMatch(html,/findRecordForVideo/);
const del=html.slice(html.indexOf('async function deleteRecord('),html.indexOf('function csvValue('));
assert.match(del,/delete\(id\)/);assert.doesNotMatch(del,/for \(const x of ids\)/);
console.log('History: same video collapses to the newest record; different videos, live and unnamed records stay separate');
