async function getApiBase(){return document.getElementById('apiBase').value}
function adminHeaders(){return {'Content-Type':'application/json','x-admin':'true','x-admin-id':'web-admin'}}

async function fetchSafes(){
  const base = await getApiBase();
  const res = await fetch(base + '/admin/safes', { headers: adminHeaders() });
  return res.json();
}

function renderList(items){
  const tbody = document.getElementById('list');
  tbody.innerHTML = '';
  for(const s of items){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${s.name||''}</td><td>${s.address}</td><td>${s.network||''}</td><td>${s.status}</td><td>${s.last_verified_at||''}</td><td class="actions"><button data-id="${s.id}" class="verify">Verify</button><button data-id="${s.id}" class="sync">Sync Balance</button><button data-id="${s.id}" class="disable">Disable</button></td>`;
    tbody.appendChild(tr);
  }
}

async function refresh(){
  const items = await fetchSafes();
  renderList(items);
}

async function addSafe(payload){
  const base = await getApiBase();
  const res = await fetch(base + '/admin/safes', { method: 'POST', headers: adminHeaders(), body: JSON.stringify(payload)});
  return res.json();
}

async function verify(id){
  const base = await getApiBase();
  const res = await fetch(base + `/admin/safes/${id}/verify`, { method: 'POST', headers: adminHeaders() });
  return res.json();
}

async function syncBalance(id){
  const base = await getApiBase();
  const res = await fetch(base + `/admin/safes/${id}/sync-balance`, { method: 'POST', headers: adminHeaders() });
  return res.json();
}

async function disable(id){
  const base = await getApiBase();
  const res = await fetch(base + `/admin/safes/${id}/disable`, { method: 'POST', headers: adminHeaders() });
  return res.json();
}

async function refreshLogs(){
  const base = await getApiBase();
  const res = await fetch(base + '/admin/audit-logs', { headers: adminHeaders() });
  const logs = await res.json();
  const ul = document.getElementById('logs');
  ul.innerHTML = '';
  for(const l of logs){
    const li = document.createElement('li');
    li.textContent = `${l.created_at} ${l.action} ${JSON.stringify(l.details)}`;
    ul.appendChild(li);
  }
}

document.getElementById('refresh').addEventListener('click', refresh);

document.getElementById('addSafe').addEventListener('click', ()=>{
  document.getElementById('modal').style.display='block';
});

document.getElementById('cancelSafe').addEventListener('click', ()=>{
  document.getElementById('modal').style.display='none';
});

document.getElementById('saveSafe').addEventListener('click', async ()=>{
  const payload = { name: document.getElementById('safeName').value, address: document.getElementById('safeAddress').value, network: document.getElementById('safeNetwork').value, is_default: document.getElementById('safeDefault').checked, notes: document.getElementById('safeNotes').value };
  const r = await addSafe(payload);
  alert('Added: ' + JSON.stringify(r));
  document.getElementById('modal').style.display='none';
  refresh();
});

// delegate actions
document.getElementById('list').addEventListener('click', async (e)=>{
  if(e.target.matches('.verify')){
    const id = e.target.dataset.id;
    const r = await verify(id);
    alert('Verified: ' + JSON.stringify(r));
    refresh();
  } else if(e.target.matches('.sync')){
    const id = e.target.dataset.id;
    const r = await syncBalance(id);
    alert('Synced: ' + JSON.stringify(r));
    refresh();
  } else if(e.target.matches('.disable')){
    const id = e.target.dataset.id;
    const r = await disable(id);
    alert('Disabled: ' + JSON.stringify(r));
    refresh();
  }
});

document.getElementById('refreshLogs').addEventListener('click', refreshLogs);

// initial load
refresh();
refreshLogs();
