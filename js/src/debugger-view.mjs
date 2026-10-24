import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const page = (token) => String.raw`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Command Stream Pipeline Debugger</title>
<style>
body{background:#101827;color:#ecf2ff;font:16px system-ui;margin:0;padding:32px;max-width:1200px;margin:auto}
h1{font-size:28px}button{border:1px solid #577899;border-radius:8px;background:#203550;color:inherit;padding:10px 18px;cursor:pointer;margin-right:8px}
.flow{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:28px 0}.stage{background:#203550;padding:18px;border-radius:10px;min-width:150px}
small{color:#a5bad5}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #314258;padding:12px}pre{white-space:pre-wrap;word-break:break-word;margin:0}#errors{color:#ffabab}
</style><h1>Pipeline debugger</h1><p>Inspect values as they pass through each stage. Pause the pipeline or advance one value at a time.</p>
<button data-action="pause">Pause</button><button data-action="step">Step</button><button data-action="resume">Resume</button> <small id="status"></small>
<div class="flow" id="flow"></div><h2>Timeline and data</h2><table><thead><tr><th>Stage</th><th>Value</th><th>Elapsed</th><th>Heap</th></tr></thead><tbody id="events"></tbody></table><pre id="errors"></pre>
<script>
const token=${JSON.stringify(token)};
const request=(path,method='GET')=>fetch('/api/'+path,{method,headers:{Authorization:'Bearer '+token}}).then(response=>response.json());
const element=(tag,text)=>{const node=document.createElement(tag);node.textContent=text;return node;};
async function refresh(){const state=await request('state');document.querySelector('#status').textContent=state.paused?'Paused':'Running';
const flow=document.querySelector('#flow');flow.replaceChildren();state.profile.forEach((stage,index)=>{if(index)flow.append(element('span','→'));const node=element('div',stage.stage);node.className='stage';node.append(element('p',stage.count+' values'),element('small',stage.duration.toFixed(1)+' ms'));flow.append(node);});
const events=document.querySelector('#events');events.replaceChildren();state.timeline.slice(-50).reverse().forEach(event=>{const row=document.createElement('tr');row.append(element('td',event.stage));const cell=document.createElement('td');cell.append(element('pre',String(event.value)));row.append(cell,element('td',event.duration.toFixed(1)+' ms'),element('td',(event.memory/1048576).toFixed(1)+' MiB'));events.append(row);});document.querySelector('#errors').textContent=state.errors.join('\n');}
document.querySelectorAll('button').forEach(button=>button.onclick=async()=>{await request(button.dataset.action,'POST');await refresh();});
refresh();setInterval(()=>refresh().catch(error=>document.querySelector('#status').textContent=error.message),500);
</script></html>`;

/** A local, authenticated live view; all values enter the DOM as text. */
export async function serveDebugger(debugger_, { port = 0 } = {}) {
  const token = randomUUID();
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/favicon.ico') {
      response.writeHead(204);
      response.end();
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/' && url.searchParams.get('token') === token) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(page(token));
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403);
      response.end(JSON.stringify({ error: 'Invalid debugger token' }));
      return;
    }
    const action = url.pathname.slice('/api/'.length);
    if (action === 'state' && request.method === 'GET') {
      response.end(
        JSON.stringify({
          paused: debugger_.paused,
          profile: debugger_.profile(),
          timeline: debugger_.timeline,
          errors: debugger_.errors,
        })
      );
    } else if (
      ['step', 'pause', 'resume'].includes(action) &&
      request.method === 'POST'
    ) {
      debugger_[action]();
      response.end('{}');
    } else {
      response.writeHead(404);
      response.end('{}');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/?token=${token}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}
