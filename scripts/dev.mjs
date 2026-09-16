// Local, synthetic protocol harness. No real space files or credentials are used.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { utils, write } from 'xlsx';
const workbook = utils.book_new();
const sheet = utils.aoa_to_sheet([['Item', 'Quantity', 'Price', 'Total'], ['Apples', 2, 3], ['Pears', 4, 2]]);
sheet.D2 = { t: 'n', f: 'B2*C2', v: 6 };
sheet.D3 = { t: 'n', f: 'B3*C3', v: 8 };
sheet.A5 = { t: 's', v: 'Total' }; sheet.D5 = { t: 'n', f: 'SUM(D2:D3)', v: 14 }; sheet['!ref'] = 'A1:D5';
utils.book_append_sheet(workbook, sheet, 'Budget');
utils.book_append_sheet(workbook, utils.aoa_to_sheet([['Notes'], ['Synthetic example workbook']]), 'Notes');
const example = Array.from(new Uint8Array(write(workbook, { type: 'array', bookType: 'xlsx' })));
const bridge = `
window.silverbullet = new EventTarget();
let nextId = 0; const pending = new Map();
window.silverbullet.syscall = (name, ...args) => new Promise((resolve, reject) => {
  const id = ++nextId; pending.set(id, {resolve, reject});
  parent.postMessage({type:'syscall', data:{id,name,args}}, '*');
});
window.silverbullet.sendMessage = (type, data) => parent.postMessage({type,data}, '*');
window.addEventListener('message', event => {
  if (event.source !== parent) return;
  const {type,data,internal} = event.data;
  if (internal && type === 'syscall-response') {
    const request = pending.get(data.id); pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result);
  } else if (internal && type === 'set-theme') {
    document.documentElement.dataset.theme = data.theme;
  } else window.silverbullet.dispatchEvent(new CustomEvent(type,{detail:data}));
});
`;
createServer(async (req, res) => {
  if (req.url === '/spreadsheet.plug.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript' });
    res.end(await readFile('dist/spreadsheet.plug.js')); return;
  }
  if (req.url !== '/') { res.writeHead(404).end(); return; }
  try {
    const editor = (await readFile('dist/spreadsheet.html', 'utf8')).replace('<head>', '<head><script>' + bridge + '</script>');
    const html = `<!doctype html><html><head><title>Spreadsheet development harness</title><style>html,body,iframe{width:100%;height:100%;margin:0;border:0;display:block}</style></head><body><iframe title="Spreadsheet"></iframe><script>
const frame=document.querySelector('iframe');
const host=window.__host={original:${JSON.stringify(example)},saved:null,writes:[],messages:[],mode:'rw',forcedRO:false,failBackup:false,path:'Example budget.xlsx'};
host.load=(name='Example budget.xlsx', bytes=host.original, perm='rw')=>{
  host.path=name; host.saved=null;
  frame.contentWindow.postMessage({type:'file-open',data:{data:new Uint8Array(bytes),meta:{name,perm,contentType:'application/octet-stream'}}},'*');
};
host.send=(type,data)=>frame.contentWindow.postMessage({type,data},'*');
window.addEventListener('message',async event=>{
  if(event.source!==frame.contentWindow)return;
  const {type,data}=event.data; host.messages.push(type);
  if(type==='file-changed') { host.send('request-save'); return; }
  if(type==='file-saved') { host.saved=Array.from(data.data); return; }
  if(type!=='syscall')return;
  let result,error;
  try {
    switch(data.name){
      case 'system.getMode': result=host.mode; break;
      case 'editor.getUiOption': result=host.forcedRO; break;
      case 'space.fileExists': result=host.writes.some(w=>w.name===data.args[0]); break;
      case 'space.writeDocument':
        if(host.failBackup)throw new Error('Backup write failed');
        host.writes.push({name:data.args[0],bytes:Array.from(data.args[1])}); result={}; break;
      case 'editor.prompt': result=window.prompt(data.args[0],data.args[1]); break;
      case 'editor.navigate': {
        const path=data.args[0].path;
        const file=host.writes.find(w=>w.name===path); if(file)host.load(path,file.bytes);
        break;
      }
      default: throw new Error('Unsupported harness syscall '+data.name);
    }
  }catch(e){error=e.message}
  frame.contentWindow.postMessage({type:'syscall-response',internal:true,data:{id:data.id,result,error}},'*');
});
frame.onload=()=>host.load();
frame.srcdoc=${JSON.stringify(editor).replace(/<\/script/gi, '<\\/script')};
</script></body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
  } catch (error) { res.writeHead(500).end('Run npm run build first.'); console.error(error); }
}).listen(4179, '127.0.0.1', () => console.log('Synthetic editor harness: http://127.0.0.1:4179'));
