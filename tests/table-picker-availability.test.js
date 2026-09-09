const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const app=fs.readFileSync('js/app.js','utf8');
const extract=name=>app.match(new RegExp('^(?:async )?function '+name+'\\([^]*?^}', 'm'))[0];
(async()=>{
 const fields={};
 for(const prefix of ['res','res-action']) for(const [key,value] of Object.entries({date:'2026-12-01',time:'18:00','start-time':'18:00','end-time':'21:00',duration:'180','block-buffer':'30','edit-id':'self',area:'a',status:'Reserved'})) fields[prefix+'-'+key]={value};
 fields['res-exclusive-area']={checked:false};fields['res-action-exclusive-area']={checked:false};
 const pending=[];
 const ctx=vm.createContext({tableAvailabilityRequests:{},tablePickerContext:{},document:{getElementById:id=>fields[id]},
  _resActionReservation:{id:'self',reservation_date:'2026-12-01',status:'Reserved'},_resActionSelectedTables:['own'],
  renderTableSelection(){},renderResActionTableGrid(){},updateResVipTimeRange(){},toast(){},t:s=>s,
  supabaseQuery:fn=>fn(),db:{rpc(name,args){assert.equal(name,'reservation_table_availability');return new Promise(resolve=>pending.push({args,resolve}));}}
 });
 vm.runInContext(['refreshTimedTablePicker','refreshResTableOccupancy','reservationTablesReady'].map(extract).join('\n'),ctx);
 const first=ctx.refreshResTableOccupancy();assert.equal(ctx.reservationTablesReady('res',[]),false,'cannot save during loading');
 assert.equal(pending[0].args.p_date,'2026-12-01','future dates are checked');assert.equal(pending[0].args.p_buffer,30);assert.equal(pending[0].args.p_exclude,'self');
 fields['res-time'].value='22:00';fields['res-end-time'].value='23:00';const second=ctx.refreshResTableOccupancy();
 pending[1].resolve({data:[{table_id:'other',occupied:true},{table_id:'own',occupied:false}]});await second;
 pending[0].resolve({data:[{table_id:'own',occupied:true}]});await first;
 assert.equal(ctx.reservationTablesReady('res',['own']),true,'old response cannot block own table');
 assert.equal(ctx.reservationTablesReady('res',['other']),false,'a selected table that now conflicts cannot save');
 const third=ctx.refreshTimedTablePicker('res-action');assert.equal(pending[2].args.p_exclude,'self');
 pending[2].resolve({error:{message:'offline'},data:null});await third;
 assert.equal(ctx.reservationTablesReady('actions',[]),false,'failed lookup is not treated as availability');
 fields['res-status'].value='Completed';await ctx.refreshResTableOccupancy();assert.equal(ctx.reservationTablesReady('res',['other']),true,'historical edits skip occupancy');
 console.log('Timed table picker: future dates, changed hours, self exclusion, loading guards, stale responses and failures passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
