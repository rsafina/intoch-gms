-- Apply only after 20261011_demo_sessions.sql on the verified playground.
begin;
create table demo_private.creation_events(ip_hash text not null,created_at timestamptz not null default clock_timestamp());
create index on demo_private.creation_events(ip_hash,created_at);
create table demo_private.pending_deletions(user_id uuid primary key,queued_at timestamptz not null default clock_timestamp());
create function public.demo_provision(p_user_id uuid,p_auth_session_id uuid,p_ip_hash text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,demo_private,intoch_demo as $$
declare workspace uuid; guest uuid; area uuid; seat uuid; booking uuid;
 today date:=(clock_timestamp() at time zone 'Asia/Jakarta')::date; day_offset integer; table_number integer;
 activation timestamptz; first_area uuid;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
 if p_ip_hash is null or length(p_ip_hash)<>64 then raise exception 'Abuse prevention unavailable'; end if;
 if not exists(select 1 from auth.users where id=p_user_id and is_anonymous) or
  not exists(select 1 from auth.sessions where id=p_auth_session_id and user_id=p_user_id) or
  exists(select 1 from public.staff_users where auth_user_id=p_user_id) then
  raise exception 'Anonymous demo identity required' using errcode='42501';
 end if;
 -- All starters serialize quota checks and activation; bounded synthetic seed.
 perform pg_advisory_xact_lock(20261011,1);
 select id into workspace from demo_private.sessions where user_id=p_user_id;
 if workspace is not null then
  if exists(select 1 from demo_private.sessions where id=workspace and auth_session_id=p_auth_session_id
   and state='active' and clock_timestamp()<expires_at) then
   return (select jsonb_build_object('id',id,'user_id',user_id,'active',true,'state',state,
    'started_at',started_at,'expires_at',expires_at,'server_now',clock_timestamp()) from demo_private.sessions where id=workspace);
  end if;
  raise exception 'This demo has ended. Start a new demo.' using errcode='42501';
 end if;
 if (select count(*) from demo_private.creation_events where ip_hash=p_ip_hash and created_at>clock_timestamp()-interval '1 hour')>=10 or
    (select count(*) from demo_private.sessions where state='active' and expires_at>clock_timestamp())>=500 then
  raise exception 'Demo creation limit reached. Please try later.' using errcode='P0001';
 end if;
 insert into demo_private.creation_events(ip_hash) values(p_ip_hash);
 insert into demo_private.sessions(user_id,auth_session_id,ip_hash) values(p_user_id,p_auth_session_id,p_ip_hash) returning id into workspace;
 perform set_config('intoch.demo_seed_workspace',workspace::text,true);

 -- Only non-sensitive behavior settings are copied; destinations/contact/assets
 -- are deliberately fictional or absent. No public customer records are copied.
 insert into intoch_demo.app_settings(workspace_id,key,value)
 select workspace,key,value from public.app_settings where key in
 ('spending_tier','membership','reservation_hours','management_dashboard');
 insert into intoch_demo.app_settings(workspace_id,key,value) values
 (workspace,'restaurant_name','"Intoch Demo Restaurant"'),
 (workspace,'financial_tracking','{"deposit_enabled":false,"spending_enabled":true}'),
 (workspace,'reservation_form','{"paused":false,"bank_details":"DEMO — no real payment","qris_url":null,"whatsapp_number":""}');
 for day_offset in 1..3 loop
  insert into intoch_demo.areas(workspace_id,name,capacity,is_bookable_online)
  values(workspace,(array['Indoor','Outdoor','Private Room'])[day_offset],24,true) returning id into area;
  if day_offset=1 then first_area:=area; end if;
  for table_number in 1..6 loop
   insert into intoch_demo.tables(workspace_id,area_id,name,capacity,is_active)
   values(workspace,area,'T'||table_number,4,true);
  end loop;
 end loop;
 -- History: new, returning and at-risk guests with real attendance records.
 for day_offset in 1..60 loop
  insert into intoch_demo.guests(workspace_id,name,phone,preference,food_allergy,notes,created_at)
  values(workspace,case day_offset when 1 then 'Budi Santoso' when 2 then 'Michelle' when 3 then 'Jessica'
   else 'Demo Guest '||day_offset end,'000'||lpad(day_offset::text,9,'0'),
   case when day_offset%3=0 then 'Quiet table by the window' else 'Outdoor seating' end,
   case when day_offset%7=0 then 'Peanuts' end,'Fictional guest for your private demo',
   (today-90)::timestamp at time zone 'Asia/Jakarta') returning id into guest;
  insert into intoch_demo.visits(workspace_id,guest_id,visit_type,visit_date,visit_time,pax,status,spend_amount,spend_recording_status)
  select workspace,guest,'Walk-In',today-(day_offset+history*7),'18:00',2+(day_offset%3),'Done',
   (150000+day_offset*15000),'recorded' from generate_series(0,case when day_offset<=40 then 3 else 0 end) history;
  if day_offset<=30 then
   insert into intoch_demo.reservations(workspace_id,guest_id,reservation_date,reservation_time,pax,status,reservation_source)
   values(workspace,guest,today-(day_offset+7),'12:00',2,'Reserved','Phone') returning id into booking;
   insert into intoch_demo.visits(workspace_id,guest_id,reservation_id,visit_type,visit_date,visit_time,pax,status,spend_amount,spend_recording_status)
   values(workspace,guest,booking,'Reservation',today-(day_offset+7),'12:00',2,'Done',200000+day_offset*10000,'recorded');
   update intoch_demo.reservations set status='Completed' where id=booking;
  end if;
  if day_offset<=12 then
   insert into intoch_demo.reservations(workspace_id,guest_id,booking_name,reservation_date,reservation_time,pax,status,assigned_area,reservation_source)
   values(workspace,guest,case day_offset when 1 then 'Budi Santoso' else 'Demo booking '||day_offset end,
    today+day_offset%7,'19:00',2,case when day_offset%5=0 then 'Cancelled' else 'Reserved' end,first_area,case when day_offset%2=0 then 'Online Form' else 'Phone' end);
  end if;
  if day_offset<=3 then
   insert into intoch_demo.visits(workspace_id,guest_id,visit_type,visit_date,visit_time,pax,status,assigned_area)
   values(workspace,guest,'Walk-In',today,'12:00',2,'Active',first_area);
  end if;
 end loop;
 activation:=clock_timestamp();
 update demo_private.sessions set state='active',started_at=activation,expires_at=activation+interval '60 minutes' where id=workspace;
 perform set_config('intoch.demo_seed_workspace','',true);
 return (select jsonb_build_object('id',id,'user_id',user_id,'active',true,'state',state,
  'started_at',started_at,'expires_at',expires_at,'server_now',clock_timestamp()) from demo_private.sessions where id=workspace);
end $$;
revoke all on function public.demo_provision(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.demo_provision(uuid,uuid,text) to service_role;

-- Queue and remove only owned demo workspaces. Auth deletion is retried separately
-- through Auth Admin API; a failed API call must not lose the deletion work item.
create function public.demo_cleanup_batch() returns jsonb language plpgsql
security definer set search_path=pg_catalog,demo_private as $$
declare workspace record;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
 for workspace in select id,user_id from demo_private.sessions
  where state='ended' or expires_at<=clock_timestamp() or
   (state='preparing' and created_at<clock_timestamp()-interval '10 minutes')
  order by created_at limit 20 for update skip locked loop
  insert into demo_private.pending_deletions(user_id) values(workspace.user_id) on conflict do nothing;
  perform set_config('intoch.demo_seed_workspace',workspace.id::text,true);
  delete from demo_private.sessions where id=workspace.id;
  delete from demo_private.audit where workspace_id=workspace.id;
  perform set_config('intoch.demo_seed_workspace','',true);
 end loop;
 delete from demo_private.creation_events where created_at<clock_timestamp()-interval '24 hours';
 insert into demo_private.pending_deletions(user_id)
 select u.id from auth.users u where u.is_anonymous and u.created_at<clock_timestamp()-interval '2 hours'
  and u.raw_user_meta_data->>'intoch_demo_version'='1'
  and not exists(select 1 from demo_private.sessions s where s.user_id=u.id)
  and not exists(select 1 from public.staff_users staff where staff.auth_user_id=u.id)
 order by u.created_at limit 20 on conflict do nothing;
 return coalesce((select jsonb_agg(user_id) from (select user_id from demo_private.pending_deletions order by queued_at limit 20) batch),'[]'::jsonb);
end $$;
create function public.demo_cleanup_confirm(p_user_id uuid) returns void language plpgsql
security definer set search_path=pg_catalog,demo_private as $$begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service access required' using errcode='42501'; end if;
 delete from demo_private.pending_deletions where user_id=p_user_id;
end $$;
revoke all on function public.demo_cleanup_batch(),public.demo_cleanup_confirm(uuid) from public,anon,authenticated;
grant execute on function public.demo_cleanup_batch(),public.demo_cleanup_confirm(uuid) to service_role;
notify pgrst,'reload schema';
commit;
