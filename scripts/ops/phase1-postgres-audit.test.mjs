import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditPostgres, readRuntimeConnection, statementShape, PROJECT, SNAPSHOT } from './phase1-postgres-audit.mjs';
const connection=`postgresql://postgres:synthetic-secret@db.${PROJECT}.supabase.co:5432/postgres?sslmode=verify-full`;
const env={PROJECT_REF:PROJECT,SUPABASE_DB_URL:connection,GITHUB_SHA:'a'.repeat(40)};

test('runtime fallback reads only the named variable after confirming the service owner',async()=>{
  const urls=[];
  const r=await readRuntimeConnection({RENDER_API_KEY:'synthetic-render-secret'},async(url,init)=>{
    urls.push(url);assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
    return Response.json(url.endsWith('/env-vars/SUPABASE_DB_URL')?{key:'SUPABASE_DB_URL',value:connection}:
      {id:'srv-d7t9ivreo5us73ftose0',ownerId:'tea-d7plj9beo5us73ch3ukg',repo:'https://github.com/ibb142/ivx-holdings-platform'});
  });
  assert.equal(urls.length,2);assert.equal(r.config.ssl.rejectUnauthorized,true);
  assert.equal(JSON.stringify(r.audit).includes('synthetic-secret'),false);
  assert.equal(JSON.stringify(r.audit).includes('synthetic-render-secret'),false);
});
test('runtime fallback refuses foreign service ownership before any secret read',async()=>{
  let requests=0;
  const r=await readRuntimeConnection({RENDER_API_KEY:'synthetic-render-secret'},async()=>{
    requests++;return Response.json({id:'srv-d7t9ivreo5us73ftose0',ownerId:'foreign-owner',repo:'https://github.com/ibb142/ivx-holdings-platform'});
  });
  assert.equal(requests,1);assert.equal(r.config,undefined);
  assert.equal(r.audit.reason,'runtime_service_identity_unverified');
});

test('the known base hostname repair stays on this project and only probes once',async()=>{
  let connects=0;
  const r=await auditPostgres({env:{...env,SUPABASE_DB_URL:connection.replace(`db.${PROJECT}.supabase.co`,'base')},makeClient:config=>{
    assert.equal(config.host,`db.${PROJECT}.supabase.co`);assert.equal(config.password,'synthetic-secret');
    return {on:()=>{},connect:async()=>{connects++;throw Object.assign(new Error('unreachable'),{code:'ENETUNREACH'});},end:async()=>{}};
  }});
  assert.equal(connects,1);assert.equal(r.bindings[0].knownHostnameRepair,true);
  assert.equal(r.bindings[0].issue,'invalid_base_hostname');assert.equal(r.ok,false);
  assert.equal(JSON.stringify(r).includes('synthetic-secret'),false);
});

test('missing, foreign-project and insecure connections open no client', async()=>{
  for (const value of [undefined,connection.replace(PROJECT,'foreignproject'),connection.replace('verify-full','disable')]) {
    const r=await auditPostgres({env:{...env,SUPABASE_DB_URL:value},makeClient:()=>{throw Error('must not connect');}});
    assert.equal(r.connectionAttempts,0);assert.equal(r.ok,false);assert.equal(r.certified,false);
    assert.equal(JSON.stringify(r).includes('synthetic-secret'),false);
  }
});
test('fixed-target TLS probe is read-only, bounded and always closes',async()=>{
  const queries=[];let ended=0;
  const r=await auditPostgres({env,makeClient:config=>{
    assert.equal(config.ssl.rejectUnauthorized,true);assert.ok(config.ssl.ca.length>0);
    assert.equal(config.connectionTimeoutMillis,5000);assert.equal(config.statement_timeout,5000);
    return {connect:async()=>{},on:()=>{},end:async()=>{ended++;},query:async sql=>{
      queries.push(sql);return {rows:sql===SNAPSHOT?[{read_only:'on',index_ready:true,claim_scope_active:true}]:[]};
    }};
  }});
  assert.equal(r.ok,true);assert.equal(r.certified,false);assert.equal(ended,1);
  assert.match(queries[0],/^BEGIN READ ONLY/);assert.equal(queries.at(-1),'ROLLBACK');
  assert.equal(queries.length,8);assert.ok(queries.slice(1,-1).every(q=>q.trim().startsWith('select ')));
  assert.equal(JSON.stringify(r).includes('synthetic-secret'),false);
});
test('lost connection response is redacted and never retries another credential',async()=>{
  let connects=0,ends=0;
  const r=await auditPostgres({env:{...env,DATABASE_URL:connection},makeClient:()=>({on:()=>{},
    connect:async()=>{connects++;throw Object.assign(new Error('password authentication failed synthetic-secret'),{code:'28P01'});},
    end:async()=>{ends++;},query:async()=>{throw Error('must not query');}})});
  assert.equal(connects,1);assert.equal(ends,1);assert.equal(r.ok,false);assert.equal(r.error.reason,'28P01');
  assert.equal(JSON.stringify(r).includes('synthetic-secret'),false);
});
test('query failure rolls back and closes without reporting false success or raw detail',async()=>{
  const queries=[];let ended=0;
  const r=await auditPostgres({env,makeClient:()=>({on:()=>{},connect:async()=>{},end:async()=>{ended++;},query:async sql=>{
    queries.push(sql);if(sql===SNAPSHOT)throw Object.assign(new Error('timeout synthetic-secret'),{code:'57014'});
    return {rows:[]};}})});
  assert.equal(r.ok,false);assert.equal(queries.at(-1),'ROLLBACK');assert.equal(ended,1);
  assert.equal(queries.length,3);assert.equal(JSON.stringify(r).includes('synthetic-secret'),false);
});
test('an unverified read-only state cannot pass the diagnostic',async()=>{
  const r=await auditPostgres({env,makeClient:()=>({on:()=>{},connect:async()=>{},end:async()=>{},
    query:async sql=>({rows:sql===SNAPSHOT?[{read_only:'off'}]:[]})})});
  assert.equal(r.ok,false);assert.equal(r.certified,false);
});

test('query statistics use an allowlisted schema and never publish raw SQL',async()=>{
  for (const schema of ['extensions','foreign_schema; select secret']) {
    const queries=[];
    const r=await auditPostgres({env,makeClient:()=>({on:()=>{},connect:async()=>{},end:async()=>{},query:async sql=>{
      queries.push(sql);return {rows:sql===SNAPSHOT?[{read_only:'on',statement_statistics_schema:schema}]:
        sql.includes('as query_text')?[{queryid:'1',query_text:"select 'synthetic-sensitive-literal' from private_table"}]:[]};
    }})});
    assert.equal(r.ok,true);
    assert.equal(queries.some(q=>q.includes('from extensions.pg_stat_statements')),schema==='extensions');
    assert.equal(queries.some(q=>q.includes('foreign_schema')),false);
    assert.equal(queries.some(q=>/select\s+query\s*[,\s]/i.test(q)),false);
    assert.equal(JSON.stringify(r).includes('synthetic-sensitive-literal'),false);
    assert.equal(JSON.stringify(r).includes('private_table'),false);
    assert.equal(JSON.stringify(r).includes('query_text'),false);
  }
});

test('SQL structure hides literals, comments, unknown names and dollar-quoted bodies',()=>{
  const sql=`SELECT "d".value FROM public.ivx_durable_documents AS d WHERE doc_key = 'secret''literal'
    /* outer sensitive /* nested secret */ hidden */ AND "private_identifier" = $tag$secret_body$tag$
    -- hidden line\n ORDER BY updated_at DESC LIMIT 100`;
  const shape=statementShape(sql);
  assert.match(shape,/from public \. ivx_durable_documents/);
  assert.match(shape,/order by updated_at desc limit \?/);
  for(const hidden of ['secret','sensitive','hidden','private_identifier','100'])assert.equal(shape.includes(hidden),false);
});
