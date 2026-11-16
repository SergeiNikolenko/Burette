'use strict';
window.LID_STUDIES = {};
const studyOf = () => window.LID_STUDIES[styleOf().study];
const StudyGeometry = {
  mean(points) { return points.length ? { x: points.reduce((n,p)=>n+p.x,0)/points.length, y: points.reduce((n,p)=>n+p.y,0)/points.length } : {x:0,y:0}; },
  box(points, pad=0) {
    if (!points.length) points=[{x:0,y:0}];
    const left=Math.min(...points.map(p=>p.x))-pad, right=Math.max(...points.map(p=>p.x))+pad;
    const top=Math.min(...points.map(p=>p.y))-pad, bottom=Math.max(...points.map(p=>p.y))+pad;
    return {left,right,top,bottom,width:right-left,height:bottom-top,x:(left+right)/2,y:(top+bottom)/2};
  },
  move(data, sid, x, y) {
    const s=data.scene.scene.structures.find(s=>s.id===sid), b=this.box(s.atoms.map(a=>a.coordinates));
    const dx=x-b.x, dy=y-b.y;
    s.atoms.forEach(a=>{a.coordinates.x+=dx;a.coordinates.y+=dy;});
    data.scene.scene.annotations.filter(a=>a.belongsTo?.type==='structure' && a.belongsTo.id===sid).forEach(a=>{a.coordinates.x+=dx;a.coordinates.y+=dy;});
  },
  // Spreads the whole depiction (bonds, partners, labels, pocket outline) around the ligand, so marks of a
  // fixed size come out smaller beside the ligand. Run from a study's prepare(), before anything is placed.
  spread(data, factor) {
    const scene=data.scene.scene, m=this.mean(scene.structures[0].atoms.map(a=>a.coordinates));
    const out=(x,y)=>[m.x+(x-m.x)*factor,m.y+(y-m.y)*factor];
    const move=p=>{[p.x,p.y]=out(p.x,p.y);};
    scene.structures.forEach(s=>s.atoms.forEach(a=>move(a.coordinates)));
    scene.annotations.forEach(a=>move(a.coordinates));
    data.overlay.contour=data.overlay.contour.map(path=>path.map(([x,y])=>out(x,y)));
  },
};

async function loadStudy() {
  const id=styleOf().study;
  if (!id || window.LID_STUDIES[id]) return;
  await new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src=`studies/${encodeURIComponent(id)}.js`;
    script.onload=resolve; script.onerror=()=>reject(new Error('Could not load this diagram.'));
    document.head.append(script);
  });
}

function applyStudyVisibility() {
  const study=studyOf();
  if (!study) return;
  const g=groups();
  const hidden=new Set(state.data.scene.scene.structures.filter(s=>study.hideBase==='all'||(study.hideBase==='partners'&&s.id!==0)).map(s=>s.id));
  for(const sid of hidden) {
    for(const map of [g.atomGroupsComponent.atomToSelMap,g.edgeGroupsComponent.edgeToSelMap,g.structureCircleGroupsComponent.structureCircleToSelMap]) {
      const e=map[sid]; if(e) setVisible([e.structureSel,e.selectorSel],false);
    }
  }
  for(const a of state.data.scene.scene.annotations) {
    if((a.belongsTo?.type==='structure'&&hidden.has(a.belongsTo.id)) || (study.hideHydrophobic&&a.belongsTo?.type==='structureSpline')) setVisible(g.annotationGroupsComponent.labelToSelMap[a.id],false);
  }
  if(study.hideHydrophobic) Object.values(g.hydrophobicGroupsComponent?.hydrophobicToSelMap||{}).forEach(e=>setVisible(e,false));
}

function drawStudy() {
  const study=studyOf();
  overlay.study?.replaceChildren(); overlay.studyUnder?.replaceChildren();
  if(!study) return;
  applyStudyVisibility();
  const scene=state.data.scene.scene;
  const structures=scene.structures.map(s=>({...s,points:liveAtoms(s.id),box:StudyGeometry.box(liveAtoms(s.id),s.representation===2?11:5)}));
  const byId=new Map(structures.map(s=>[s.id,s]));
  const point=(sid,id,ring=false)=>{
    const s=byId.get(sid); if(!s) return null;
    const r=ring&&(s.rings||[]).find(r=>r.id===id);
    return r?StudyGeometry.mean(r.atoms.map(a=>liveAtom(sid,a)).filter(Boolean)):liveAtom(sid,id);
  };
  const contacts=state.data.contacts.map((record,index)=>{
    const edge=(scene[record.type]||[]).find(e=>e.id===record.id);
    let a=null,b=null;
    if(edge && record.type!=='hydrophobicContacts') {
      const from=point(edge.fromStructure,edge.from,record.type==='piStackings'||record.type==='cationPiStackings');
      const to=point(edge.toStructure,edge.to,record.type==='piStackings');
      [a,b]=edge.toStructure===0?[to,from]:[from,to];
    }
    const ligand=structures[0];
    if(!a) {
      const ref=Object.entries(state.data.atomRefs||{}).find(([id,v])=>v.atom===record.ligandAtom&&ligand.atoms.some(at=>String(at.id)===id));
      const atom=ligand.atoms.find(at=>at.additionalInformation?.atomName===record.ligandAtom||at.label===record.ligandAtom);
      a=(atom&&liveAtom(0,atom.id))||(ref&&liveAtom(0,Number(ref[0])))||{x:ligand.box.x,y:ligand.box.y};
    }
    const partner=byId.get(record.structure);
    if(!b&&partner&&partner.id!==0) b={x:partner.box.x,y:partner.box.y};
    // structures at the two ends, so a dragged structure can carry its contact lines
    const [sa,sb]=edge&&record.type!=='hydrophobicContacts'?(edge.toStructure===0?[0,edge.fromStructure]:[edge.fromStructure,edge.toStructure]):[0,record.structure];
    return {record,index,kind:kindOf(record),color:colorOf(kindOf(record)),a,b,sa,sb,partner,
      visible:!state.hiddenKinds.has(kindOf(record))&&structureVisible(record.structure)&&(!edge||record.type==='hydrophobicContacts'||(structureVisible(edge.fromStructure)&&structureVisible(edge.toStructure))),label:record.residue,distance:record.distance};
  });
  window.LidMotion?.record(contacts.map(({a,b,sa,sb})=>({a:a&&{...a},b:b&&{...b},sa,sb})));
  const root=overlay.study, under=overlay.studyUnder;
  const fg=atomColors().DEFAULT,bg=atomColors().BACKGROUND, muted=state.theme==='dark'?'#a1a1aa':'#71717a',hair=state.theme==='dark'?'#52525b':'#d4d4d8';
  const el=(tag,attrs={},parent=root)=>svgEl(tag,attrs,parent);
  const text=(x,y,value,attrs={},parent=root)=>{const n=el('text',{x,y,fill:fg,'font-size':6,'font-family':'Helvetica, Arial, sans-serif',...attrs},parent);n.textContent=value;return n;};
  const hit=(node,index)=>{node.dataset.contactIndex=index;node.setAttribute('role','button');node.setAttribute('tabindex','0');node.setAttribute('aria-label',`${contacts[index].label}, ${KINDS[contacts[index].kind].label}, ${contacts[index].distance.toFixed(2)} angstroms`);node.style.cursor='pointer';return node;};
  const line=(a,b,attrs={},parent=under)=>el('line',{x1:a.x,y1:a.y,x2:b.x,y2:b.y,stroke:fg,'stroke-width':0.65,...attrs},parent);
  const badge=(contact,x,y,label=String(contact.index+1),parent=root)=>{
    const g=hit(el('g',{},parent),contact.index),width=Math.max(9,String(label).length*3.7+5);
    el('rect',{x:x-width/2,y:y-5,width,height:10,rx:2,fill:bg,stroke:contact.color,'stroke-width':0.6},g);
    text(x,y+2,label,{'text-anchor':'middle',fill:contact.color,'font-size':6},g);return g;
  };
  const connect=(c,attrs={})=>{
    if(!c.visible||!c.a||!c.b) return null;
    const dx=c.b.x-c.a.x,dy=c.b.y-c.a.y,l=Math.hypot(dx,dy)||1;
    const a={x:c.a.x+dx/l*4,y:c.a.y+dy/l*4},b={x:c.b.x-dx/l*4,y:c.b.y-dy/l*4};
    const g=hit(el('g',{},under),c.index);
    line(a,b,{stroke:c.color,'stroke-dasharray':'2 2',...attrs},g);
    line(a,b,{stroke:'transparent','stroke-width':8,'pointer-events':'stroke'},g);return g;
  };
  const molecule=(sid,x,y,scale=1,parent=root)=>{
    const s=byId.get(sid);if(!s)return null;
    const wrapper=el('g',{transform:`translate(${x},${y}) scale(${scale}) translate(${-s.box.x},${-s.box.y})`},parent);
    const g=groups();
    const maps=s.representation===2?[g.structureCircleGroupsComponent.structureCircleToSelMap]:[g.edgeGroupsComponent.edgeToSelMap,g.atomGroupsComponent.atomToSelMap];
    for(const map of maps){const src=map[sid]?.structureSel?.node();if(!src)continue;const clone=src.cloneNode(true);clone.style.removeProperty('display');clone.removeAttribute('id');clone.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));wrapper.append(clone);}
    return wrapper;
  };
  const ctx={root,under,el,text,line,hit,badge,connect,molecule,structures,byId,ligand:structures[0],partners:structures.slice(1),contacts,
    data:state.data,fg,bg,muted,hair,theme:state.theme,selected:state.selected,H:StudyGeometry,kindLabel:k=>KINDS[k]?.label||k,liveAtom,liveAtoms};
  study.draw(ctx);
  paintContactBadges();
}
