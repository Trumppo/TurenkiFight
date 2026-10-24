import { describe, it, expect } from 'vitest';
import { createState, step, standings, MATCH_TICKS, COUNTDOWN_TICKS } from './step';
import type { PlayerInput } from './types';
const neutral = (playerId: string): PlayerInput => ({playerId,moveX:0,moveY:0,jump:false});
describe('M1 Score Brawl', () => {
 it('creates deterministic unique 2-4 player rosters', () => {
   for (const n of [2,3,4]) {
     const ids=Array.from({length:n},(_,i)=>'P'+(i+1));
     const a=createState(ids),b=createState(ids);
     expect(a).toEqual(b);
     expect(new Set(a.fighters.map(f=>f.id)).size).toBe(n);
     expect(new Set(a.fighters.map(f=>f.x+','+f.y)).size).toBe(n);
   }
 });
 it('counts down without consuming match time and ends exactly on tick 7200', () => {
   let s=createState();
   for(let i=0;i<COUNTDOWN_TICKS;i++) s=step(s,[]);
   expect(s.phase).toBe('fighting');
   expect(s.remainingTicks).toBe(MATCH_TICKS);
   for(let i=0;i<MATCH_TICKS;i++) s=step(s,[]);
   expect(s.phase).toBe('results');
   expect(s.remainingTicks).toBe(0);
   expect(step(s,[]).events).toEqual([]);
 });
 it('is immutable and repeatable over a complete match', () => {
   const initial=createState(['P1','P2','P3','P4']);
   const before=JSON.stringify(initial);
   const run=()=>{
     let s=initial;
     let checksum=0;
     for(let i=0;i<COUNTDOWN_TICKS+MATCH_TICKS;i++){
       const inputs=s.fighters.map(f=>({...neutral(f.id),moveX:(i%120<60?1:-1) as -1|1,punch:i%47===0}));
       s=step(s,inputs);
       checksum=(Math.imul(checksum,31)+JSON.stringify(s.events).length)>>>0;
     }
     return {s,checksum};
   };
   expect(run()).toEqual(run());
   expect(JSON.stringify(initial)).toBe(before);
 });
 it('normalizes diagonal speed',()=>{
   const start=createState();
   const active={...start,phase:'fighting' as const};
   const cardinal=step(active,[{...neutral('P1'),moveX:1}]).fighters[0];
   const diagonal=step(active,[{...neutral('P1'),moveX:1,moveY:1}]).fighters[0];
   expect(Math.hypot(diagonal.x-95,diagonal.y-159)).toBeCloseTo(cardinal.x-95,8);
 });
 it('supports exact shared ranks',()=>{
   const s=createState(['P2','P1']);
   expect(standings(s)).toEqual([{id:'P1',score:0,rank:1},{id:'P2',score:0,rank:1}]);
 });
});
