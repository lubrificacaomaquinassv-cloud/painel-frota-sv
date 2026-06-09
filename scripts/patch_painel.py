"""Baixa index.html do painel-frota-sv e aplica melhorias operacionais."""
import re
import urllib.request
from pathlib import Path

URL = "https://raw.githubusercontent.com/lubrificacaomaquinassv-cloud/painel-frota-sv/main/index.html"
OUT = Path(__file__).resolve().parents[1] / "index.html"

CSS_ADD = """
.month-bar{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px;align-items:center;}
.month-bar .ml{font-size:10px;color:var(--text3);letter-spacing:1px;text-transform:uppercase;margin-right:4px;}
.ms{padding:4px 10px;font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;border:1px solid var(--border);background:var(--bg3);color:var(--text2);border-radius:6px;cursor:pointer;text-transform:uppercase;}
.ms.active{background:var(--green);color:#fff;border-color:var(--green);}
.os-layout{display:grid;grid-template-columns:1fr;gap:16px;margin-bottom:16px;}
.posto-top{display:grid;grid-template-columns:200px 1fr;gap:16px;margin-bottom:20px;align-items:stretch;}
@media(max-width:720px){.posto-top{grid-template-columns:1fr;}}
"""

HELPER_JS = """
// ── Filtros de mês + lub v3 ───────────────────────────────────
const MESES_PT=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
let _osAll=[], _combAll=[], _osMesSel=null, _combMesSel=null;

function monthKey(d){const x=new Date(d);return x.getFullYear()+'-'+(x.getMonth()+1);}
function monthLabel(key){const [y,m]=key.split('-').map(Number);return MESES_PT[m-1]+'/'+String(y).slice(-2);}
function monthRange(key){const [y,m]=key.split('-').map(Number);const ini=new Date(y,m-1,1);const fim=new Date(y,m,0,23,59,59,999);return{ini,fim};}
function currentMonthKey(){const n=new Date();return n.getFullYear()+'-'+(n.getMonth()+1);}

function buildMonthBar(containerId, keys, activeKey, onPick){
 const el=document.getElementById(containerId);
 if(!el) return;
 const uniq=[...new Set(keys)].sort((a,b)=>b.localeCompare(a));
 if(!uniq.length){el.innerHTML='';return;}
 const pick=activeKey && uniq.includes(activeKey)?activeKey:uniq[0];
 el.innerHTML='<span class="ml">Período</span>'+uniq.map(k=>`<button type="button" class="ms ${k===pick?'active':''}" data-m="${k}">${monthLabel(k)}</button>`).join('');
 el.querySelectorAll('.ms').forEach(btn=>btn.addEventListener('click',()=>onPick(btn.dataset.m)));
 onPick(pick);
}

function isFrotaInterna(f){return /^\\d{4}/.test(String(f||''));}

async function fetchLubV3Panel(){
 const [v3, ult, equip] = await Promise.all([
   sbFetch('lubrificacao_v3','select=vehicle,hourmeter_atual,hourmeter_prox,data_servico&order=data_servico.desc'),
   sbFetch('ultima_troca_lubri','select=frota,horimetro_ultima_troca,data_ultima_troca'),
   sbFetch('dim_equipamento_lubri','select=frota,intervalo_horas,ativo&ativo=eq.true')
 ]);
 const ultMap={}; ult.forEach(u=>{ultMap[String(u.frota)]=u;});
 const eqMap={}; equip.forEach(e=>{eqMap[String(e.frota)]=e;});
 const latest={};
 v3.forEach(r=>{
   const f=String(r.vehicle||'').trim(); if(!f) return;
   if(!latest[f]) latest[f]={vehicle:f,h_atual:Number(r.hourmeter_atual)||0,h_prox:Number(r.hourmeter_prox)||0,data:r.data_servico};
 });
 const frotas=new Set([...Object.keys(latest),...Object.keys(ultMap),...Object.keys(eqMap)]);
 return [...frotas].map(f=>{
   const l=latest[f]||{};
   const u=ultMap[f]||{};
   const eq=eqMap[f]||{};
   const hTroca=Number(u.horimetro_ultima_troca)||0;
   const hAtual=Number(l.h_atual)||hTroca;
   const intervalo=Number(eq.intervalo_horas)||250;
   const hProx=Number(l.h_prox)||(hTroca?hTroca+intervalo:0);
   const rest=hProx?hProx-hAtual:0;
   let status='OK';
   if(rest<=0) status='EM ATRASO';
   else if(rest<=100) status='PROXIMO';
   return {
     vehicle:f,
     ultima_troca:u.data_ultima_troca||l.data||null,
     h_na_troca:hTroca,
     h_proxima_troca:hProx,
     h_atual:hAtual,
     horas_restantes:rest,
     status_troca:status
   };
 }).sort((a,b)=>a.horas_restantes-b.horas_restantes);
}
"""

def patch(html: str) -> str:
    if ".month-bar" not in html:
        html = html.replace("</style>", CSS_ADD + "\n</style>", 1)

    # OS: month bar + remove chart grid (keep table only)
    html = re.sub(
        r'(<div class="page" id="page-os">.*?<div class="kpi-row">.*?</div>\s*)<div class="grid2">',
        r'\1<div id="os-month-bar" class="month-bar"></div><div class="card"><div class="ct"><span></span>Ranking OS — Volume + Parada</div><div id="os-table" class="loading">CARREGANDO...</div></div><div class="grid2" style="display:none">',
        html,
        count=1,
        flags=re.S,
    )

    # Combustivel: month bar above detail
    html = re.sub(
        r'(<div class="card">\s*<div class="ct"><span></span>Detalhamento: Frota × Litros × Preço × Custo</div>\s*)<div class="filter-bar">',
        r'\1<div id="comb-month-bar" class="month-bar"></div><div class="filter-bar">',
        html,
        count=1,
        flags=re.S,
    )

    # Posto: tank row same height as KPIs (class posto-top)
    html = html.replace('class="combrow"', 'class="combrow posto-top"', 2)

    # Inject helper before loadOS
    if "fetchLubV3Panel" not in html:
        html = html.replace("// ── OS ──", HELPER_JS + "\n// ── OS ──", 1)

    # Replace loadOS body
    html = re.sub(
        r"async function loadOS\(\)\{\s*try\{[\s\S]*?\}catch\(e\)\{document\.getElementById\('os-table'\)\.innerHTML=` Erro: \$\{e\.message\} `;\}\s*\}",
        """async function loadOS(){
 try{
  _osAll=await sbFetch('vw_ranking_os','order=mes.desc,frota.asc');
  const keys=_osAll.map(d=>monthKey(d.mes)).filter(Boolean);
  buildMonthBar('os-month-bar', keys, currentMonthKey(), renderOSMonth);
 }catch(e){document.getElementById('os-table').innerHTML=` Erro: ${e.message} `;}
}
function renderOSMonth(mesKey){
 _osMesSel=mesKey;
 document.querySelectorAll('#os-month-bar .ms').forEach(b=>b.classList.toggle('active', b.dataset.m===mesKey));
 const data=_osAll.filter(d=>monthKey(d.mes)===mesKey);
 const tOS=data.reduce((s,d)=>s+(Number(d.total_os)||0),0);
 const tC=data.reduce((s,d)=>s+(Number(d.os_corretiva)||0),0);
 const tP=data.reduce((s,d)=>s+(Number(d.os_preventiva)||0),0);
 const tH=data.reduce((s,d)=>s+(Number(d.horas_parada)||0),0);
 document.getElementById('kpi-total-os').textContent=fmt(tOS);
 document.getElementById('kpi-os-corr').textContent=fmt(tC);
 document.getElementById('kpi-os-prev').textContent=fmt(tP);
 document.getElementById('kpi-hp-total').textContent=fmt(tH,1)+'h';
 const sc=s=>s==='CRITICO'?'st-crit':s==='ATENCAO'?'st-aten':'st-norm';
 document.getElementById('os-table').innerHTML=`<table><thead><tr><th>Frota</th><th>OS</th><th>Corret.</th><th>Prevent.</th><th>H.parada</th><th>Custo</th><th>Status</th></tr></thead><tbody>
 ${data.map(d=>`<tr><td>${d.frota}</td><td>${fmt(d.total_os)}</td><td>${fmt(d.os_corretiva)}</td><td>${fmt(d.os_preventiva)}</td><td>${fmt(d.horas_parada,1)}h</td><td>${fmtR(d.custo_total)}</td><td><span class="st ${sc(d.status)}">${d.status}</span></td></tr>`).join('')||'<tr><td colspan="7">Sem OS no período</td></tr>'}
 </tbody></table>`;
}""",
        html,
        count=1,
    )

    # Replace loadLub
    html = re.sub(
        r"async function loadLub\(\)\{\s*try\{[\s\S]*?\}catch\(e\)\{document\.getElementById\('lub-table'\)\.innerHTML=` Erro: \$\{e\.message\} `;\}\s*\}",
        """async function loadLub(){
 try{
  const data=await fetchLubV3Panel();
  document.getElementById('kpi-ok').textContent=data.filter(d=>d.status_troca==='OK').length;
  document.getElementById('kpi-prox').textContent=data.filter(d=>d.status_troca==='PROXIMO').length;
  document.getElementById('kpi-atr').textContent=data.filter(d=>d.status_troca==='EM ATRASO').length;
  document.getElementById('kpi-total-lub').textContent=data.length;
  const sc=s=>s==='EM ATRASO'?'st-atr':s==='PROXIMO'?'st-prox':'st-ok';
  document.getElementById('lub-table').innerHTML=`<table><thead><tr><th>Frota</th><th>Última troca</th><th>H.troca</th><th>Próxima(h)</th><th>H.atual</th><th>H.restantes</th><th>Status</th></tr></thead><tbody>
 ${data.map(d=>`<tr><td>${d.vehicle}</td><td>${d.ultima_troca?new Date(d.ultima_troca).toLocaleDateString('pt-BR'):'—'}</td><td>${fmt(d.h_na_troca,0)}h</td><td>${fmt(d.h_proxima_troca,0)}h</td><td>${fmt(d.h_atual,0)}h</td><td>${fmt(d.horas_restantes,0)}h</td><td><span class="st ${sc(d.status_troca)}">${d.status_troca}</span></td></tr>`).join('')}
 </tbody></table>`;
 }catch(e){document.getElementById('lub-table').innerHTML=` Erro: ${e.message} `;}
}""",
        html,
        count=1,
    )

    # Replace loadCombustivel + filtrarFrota
    html = re.sub(
        r"async function loadCombustivel\(\)\{[\s\S]*?\}\s*let _combData=\[\];[\s\S]*?function renderCombTable\(data\)\{[\s\S]*?\}",
        """async function loadCombustivel(){
 try{
  const [posto, combo] = await Promise.all([
    sbFetch('posto','select=vehicle,fuel_type,liters,created_at'),
    sbFetch('comboio_v2','select=vehicle,fuel_type,liters,created_at')
  ]);
  const rows=[...posto,...combo].filter(r=>Number(r.liters)>0);
  const priceRows=await sbFetch('preco_insumo','select=id_insumo,valor_unitario&ativo=eq.true');
  const ins=await sbFetch('dim_insumo','select=id_insumo,nome,categoria&categoria=eq.LUBRIFICANTE');
  void ins;
  const precoDiesel=Number((priceRows.find(p=>String(p.id_insumo).startsWith('P-'))||{}).valor_unitario)||0;
  const agg={};
  rows.forEach(r=>{
    const frota=String(r.vehicle||'').trim(); if(!frota) return;
    const k=frota+'|'+labelFuel(r.fuel_type);
    if(!agg[k]) agg[k]={frota,combustivel:labelFuel(r.fuel_type),total_litros:0,meses:[],created_at:r.created_at};
    agg[k].total_litros+=Number(r.liters)||0;
    agg[k].meses.push(r.created_at);
  });
  _combAll=Object.values(agg).map(x=>{
    const preco=precoDiesel||0;
    return {...x, preco_litro:preco, custo_total:x.total_litros*preco, mes: x.meses.sort().slice(-1)[0]};
  });
  const keys=_combAll.flatMap(d=>d.meses.map(m=>monthKey(m))).filter(Boolean);
  buildMonthBar('comb-month-bar', keys, currentMonthKey(), renderCombMonth);
  filtrarFrota('todos');
 }catch(e){document.getElementById('comb-table').innerHTML=` Erro: ${e.message} `;}
}
let _combData=[];
function renderCombMonth(mesKey){
 _combMesSel=mesKey;
 document.querySelectorAll('#comb-month-bar .ms').forEach(b=>b.classList.toggle('active', b.dataset.m===mesKey));
 const {ini,fim}=monthRange(mesKey);
 _combData=_combAll.filter(d=>d.meses.some(m=>{const dt=new Date(m);return dt>=ini&&dt<=fim;}));
 filtrarFrota(document.getElementById('toggle-interna').style.background.includes('green')?'interna':'todos');
}
function filtrarFrota(modo){
 document.getElementById('toggle-todos').style.background=modo==='todos'?'var(--green)':'var(--bg3)';
 document.getElementById('toggle-todos').style.color=modo==='todos'?'#fff':'var(--text2)';
 document.getElementById('toggle-interna').style.background=modo==='interna'?'var(--green)':'var(--bg3)';
 document.getElementById('toggle-interna').style.color=modo==='interna'?'#fff':'var(--text2)';
 const base=_combData.length?_combData:_combAll;
 const d=modo==='interna'?base.filter(x=>isFrotaInterna(x.frota)):base;
 renderCombTable(d);
 barChart(document.getElementById('comb-chart'),d.filter(x=>x.custo_total),'frota','custo_total','var(--yellow)');
 barChart(document.getElementById('comb-vol-chart'),d.filter(x=>x.total_litros),'frota','total_litros','var(--green)');
 const tL=d.reduce((s,x)=>s+(Number(x.total_litros)||0),0);
 const tC=d.reduce((s,x)=>s+(Number(x.custo_total)||0),0);
 const fr=[...new Set(d.map(x=>x.frota))].length;
 document.getElementById('kpi-comb-litros').textContent=fmt(tL,0)+'L';
 document.getElementById('kpi-comb-custo').textContent=fmtR(tC);
 document.getElementById('kpi-comb-frotas').textContent=fr;
 document.getElementById('kpi-comb-media').textContent=fmtR(fr>0?tC/fr:0);
}
function renderCombTable(data){
 document.getElementById('comb-table').innerHTML=`<table><thead><tr><th>Frota</th><th>Combustível</th><th>Total (L)</th><th>Preço/L</th><th>Custo Total</th></tr></thead><tbody>
 ${data.map(d=>`<tr><td>${d.frota}</td><td>${d.combustivel||'—'}</td><td>${fmt(d.total_litros,1)}</td><td>${fmtR(d.preco_litro)}</td><td>${fmtR(d.custo_total)}</td></tr>`).join('')||'<tr><td colspan="5">Sem dados no período</td></tr>'}
 </tbody></table>`;
}""",
        html,
        count=1,
    )

    return html


def main():
    with urllib.request.urlopen(URL, timeout=90) as r:
        html = r.read().decode("utf-8")
    patched = patch(html)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(patched, encoding="utf-8")
    print("patched", OUT, "bytes", OUT.stat().st_size)


if __name__ == "__main__":
    main()
