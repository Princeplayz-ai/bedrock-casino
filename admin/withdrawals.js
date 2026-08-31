async function getApiBase(){return document.getElementById('apiBase').value}
function adminHeaders(){return {'Content-Type':'application/json','x-admin':'true','x-admin-id':'web-admin'}}

async function fetchWithdrawals(){
  const base = await getApiBase();
  const res = await fetch(base + '/admin/withdrawals', { headers: adminHeaders() });
  return res.json();
}

function renderList(items){
  const tbody = document.getElementById('list');
  tbody.innerHTML = '';
  for(const w of items){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${w.user_id}</td><td>${w.to_address}</td><td>${w.amount}</td><td>${w.token}</td><td>${w.status}</td><td>${w.safe_id||''}</td><td>${w.prepared_tx?JSON.stringify(w.prepared_tx):''}</td><td class="actions"><button data-id="${w.id}" class="approve">Approve</button><button data-id="${w.id}" class="mark-sent">Mark Sent</button></td>`;
    tbody.appendChild(tr);
  }
}

async function refresh(){
  const items = await fetchWithdrawals();
  renderList(items);
}

async function createWithdrawal(payload){
  const base = await getApiBase();
  const res = await fetch(base + '/withdrawals', { method: 'POST', headers: {'Content-Type':'application/json','x-user-id':payload.user_id}, body: JSON.stringify({ to_address: payload.to_address, amount: payload.amount, token: payload.token })});
  return res.json();
}

async function approve(id){
  const base = await getApiBase();
  const res = await fetch(base + `/admin/withdrawals/${id}/approve`, { method: 'POST', headers: adminHeaders() });
  return res.json();
}

async function markSent(id){
  const base = await getApiBase();
  const res = await fetch(base + `/admin/withdrawals/${id}/mark-sent`, { method: 'POST', headers: adminHeaders(), body: JSON.stringify({ tx_hash: '0xmock' }) });
  return res.json();
}

document.getElementById('refresh').addEventListener('click', refresh);

document.getElementById('create').addEventListener('click', async ()=>{
  const payload = { user_id: document.getElementById('userId').value, to_address: document.getElementById('toAddr').value, amount: document.getElementById('amount').value, token: document.getElementById('token').value };
  const r = await createWithdrawal(payload);
  alert('Created: ' + JSON.stringify(r));
  refresh();
});

// delegate actions
document.getElementById('list').addEventListener('click', async (e)=>{
  if(e.target.matches('.approve')){
    const id = e.target.dataset.id;
    const r = await approve(id);
    alert('Approved: ' + JSON.stringify(r));
    refresh();
  } else if(e.target.matches('.mark-sent')){
    const id = e.target.dataset.id;
    const r = await markSent(id);
    alert('Marked sent: ' + JSON.stringify(r));
    refresh();
  }
});

// initial load
refresh();
