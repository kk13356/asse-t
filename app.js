import {MODELS,GROUPS,defaults,uid,modelOf,prompts,validate,parseBackup,safeName,migrateSettings,activeCharacters,assignmentFor,batchExpressions} from './core.js';
import {db,saveSettings} from './db.js';
import {connect,login,readImage,prepare,generate} from './api.js?v=1.2.3';
import {runJobs} from './queue.js';
import {readMetadata,applyMetadata} from './metadata.js';

const $=s=>document.querySelector(s),app=$('#app'),modal=$('#modal');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icons={grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',sliders:'<path d="M5 3v18M12 3v18M19 3v18"/><path d="M2 8h6m1 8h6m1-10h6"/>',plug:'<path d="M9 3v5m6-5v5M7 8h10v4a5 5 0 0 1-10 0zM12 17v4"/>',download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',arrow:'<path d="m9 5 7 7-7 7"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z"/>',plus:'<path d="M12 5v14M5 12h14"/>',check:'<path d="m5 12 4 4L19 6"/>',image:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M15 8V4H4v11h4"/>',folder:'<path d="M3 7V4h6l3 3h9v13H3z"/>',save:'<path d="M4 3h13l4 4v14H3V3zM8 3v6h8V3M7 21v-8h10v8"/>'};
const icon=(name,size=20)=>`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]||icons.grid}</svg>`;
let state,results=[],route='',saveTimer,saveChain=Promise.resolve(),resultUrls=[],controller=null,retryResolve=null;
let queue={phase:'idle',index:0,total:0},search='',group='전체',galleryFilter='all',apiChecked=false,storageError=false,pendingImages=[];
const total=()=>batchExpressions(state).length*state.generation.copies;
const style=()=>state.styles.find(x=>x.id===state.selectedStyle);
const character=()=>state.characters.find(x=>x.id===state.selectedCharacter);
const profile=()=>state.api.profiles[state.api.provider];
const active=()=>!!controller;
const checked=x=>x?'checked':'';
const selected=(a,b)=>a===b?'selected':'';
function toast(message,error=false) {const el=$('#toast');el.textContent=message;el.className=error?'show error':'show';clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.className='',6000);}
function persist() {clearTimeout(saveTimer);saveTimer=setTimeout(()=>{flush().catch(e=>toast(e.message,true));},250);$('#saved-label')?.replaceChildren(document.createTextNode('저장 중…'));}
async function flush() {
  clearTimeout(saveTimer);const snapshot=structuredClone(state);
  saveChain=saveChain.catch(()=>{}).then(()=>saveSettings(snapshot));
  try {await saveChain;storageError=false;if($('#saved-label'))$('#saved-label').textContent='이 브라우저에 저장됨';}
  catch {storageError=true;if($('#saved-label'))$('#saved-label').textContent='저장 실패';throw Error('브라우저 저장 공간이 부족하거나 저장이 차단되었습니다. 백업 파일을 다운로드해 주세요.');}
}
function bindGet(path){const parts=path.split('.');let obj=state;if(parts[0]==='style'){obj=style();parts.shift();}if(parts[0]==='character'){obj=character();parts.shift();}if(parts[0]==='profile'){obj=profile();parts.shift();}return {obj,key:parts.pop(),parents:parts};}
function bindSet(path,value){let {obj,key,parents}=bindGet(path);for(const p of parents)obj=obj[p];obj[key]=value;}
function themeChooser(){return `<div class="theme-chooser" role="group" aria-label="UI 테마"><span>테마</span>${[['dark','기본'],['beige','베이지'],['pink','분홍']].map(([id,name])=>`<button data-action="theme" data-theme="${id}" class="theme-chip ${state.theme===id?'chosen':''}" aria-pressed="${state.theme===id}"><i class="theme-swatch ${id}"></i>${name}</button>`).join('')}</div>`;}
function field(label,path,value,{type='text',min,max,step,placeholder='',help='',rows=3}={}) {
  const id='field-'+path.replaceAll('.','-');
  return `<label class="field" for="${id}"><span>${label}</span>${type==='textarea'?`<textarea id="${id}" data-bind="${path}" rows="${rows}" placeholder="${esc(placeholder)}" spellcheck="false">${esc(value)}</textarea>`:`<input id="${id}" data-bind="${path}" type="${type}" value="${esc(value)}" ${min!==undefined?`min="${min}"`:''} ${max!==undefined?`max="${max}"`:''} ${step!==undefined?`step="${step}"`:''} placeholder="${esc(placeholder)}" ${type==='password'?'autocomplete="off"':''}>`}${help?`<small>${help}</small>`:''}</label>`;
}
function nav(id,label,ico) {return `<a href="#/${id}" class="nav-item ${route===id?'active':''}" ${route===id?'aria-current="page"':''}>${icon(ico)}<span>${label}</span>${id==='results'?`<span class="nav-count">${results.length}</span>`:''}</a>`;}
function shell(content) {
  return `<aside class="sidebar"><a class="brand" href="#/settings"><span class="brand-symbol">A</span><span>asset<span class="brand-light">studio</span><small>CHARACTER WORKSPACE</small></span></a><div class="workspace-badge"><span class="tiny-square"></span>나의 에셋 작업실<span class="local">LOCAL</span></div><p class="nav-caption">WORKSPACE</p><nav>${nav('settings','이미지 생성 설정','sliders')}${nav('results','생성 결과','grid')}</nav><p class="nav-caption">PREFERENCES</p><nav>${nav('connection','API 연결','plug')}${nav('backup','백업 & 불러오기','folder')}</nav><div class="sidebar-bottom"><div class="privacy-mark">${icon('save',16)}<span id="saved-label">${storageError?'저장 실패':'이 브라우저에 저장됨'}</span></div><p>프롬프트부터 표정까지,<br>나만의 에셋 라이브러리.</p><span class="version">ASSET STUDIO / 1.2</span></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">작업실 ${icon('arrow',14)} <strong>${{settings:'이미지 생성 설정',results:'생성 결과',connection:'API 연결',backup:'백업 & 불러오기'}[route]}</strong></div><a class="connection-pill" href="#/connection"><span class="status-dot ${profile().token?'configured':''}"></span>${state.api.provider==='novelai'?'NovelAI':'SharedNAI'}<span class="muted">${profile().token?'설정됨':'미연결'}</span></a></header><main>${content}</main><div id="queue-bar"></div></div>`;
}
function title(kicker,title,desc,action='') {return `<div class="page-heading"><div><div class="eyebrow">${kicker}</div><h1>${title}</h1><p>${desc}</p></div>${action}</div>`;}
function sectionHeader(n,title,sub='',right=''){return `<div class="section-header"><div class="section-title"><span class="section-number">${n}</span><h2>${title}</h2>${sub?`<span class="section-sub">${sub}</span>`:''}</div>${right}</div>`;}
function presetSelector(kind,items,current){return `<div class="preset-selector"><select aria-label="${kind==='style'?'그림체':'캐릭터'} 프리셋" data-select="${kind}">${items.map(x=>`<option value="${esc(x.id)}" ${selected(x.id,current)}>${esc(x.name)}</option>`).join('')}</select><button class="icon-button" data-action="preset-new" data-kind="${kind}" title="새 프리셋" aria-label="새 ${kind==='style'?'그림체':'캐릭터'} 프리셋">${icon('plus')}</button><button class="quiet-button" data-action="preset-edit" data-kind="${kind}">관리</button></div>`;}
function characterSelection(){return `<p class="section-description">한 이미지에 등장할 캐릭터를 선택하세요. 여러 명을 함께 선택할 수 있습니다.</p><div class="character-picks">${state.characters.map(c=>`<div class="character-pick ${state.selectedCharacters.includes(c.id)?'chosen':''}"><label><input type="checkbox" data-character-pick="${esc(c.id)}" ${checked(state.selectedCharacters.includes(c.id))}><strong>${esc(c.name)}</strong></label><button class="text-button" data-action="focus-character" data-id="${esc(c.id)}" aria-label="${esc(c.name)} 프롬프트 편집">편집</button></div>`).join('')}</div>`;}
function multiCharacterPanel(){const chars=activeCharacters(state);if(chars.length<2)return '';return `<div class="multi-panel"><div class="section-header"><h3>캐릭터별 표정 & 포즈</h3><span class="count-pill">${chars.length}명 함께 생성</span></div><p class="help">‘선택한 표정 순회’ 캐릭터만 아래 표정 목록을 따라 바뀝니다. 모두 고정하면 한 가지 조합만 생성합니다.</p>${field('공통 장면 · 인원수','multi.scene',state.multi.scene,{type:'textarea',rows:2,placeholder:'예: 1girl, 1boy, couple, holding hands, side by side',help:'인원수·관계는 공통 장면에, 외형과 각자의 행동은 캐릭터별로 입력하세요.'})}<label class="check-label"><input type="checkbox" data-bind="multi.useCoords" ${checked(state.multi.useCoords)}> 캐릭터 위치 직접 지정</label><div class="assignment-list">${chars.map((c,index)=>{state.assignments[c.id]??={...assignmentFor(state,c.id)};const a=state.assignments[c.id],prefix=`assignments.${c.id}`;return `<article class="assignment-card"><div class="assignment-heading"><strong><span>${index+1}</span> ${esc(c.name)}</strong><div><button class="text-button" data-action="move-character" data-id="${esc(c.id)}" data-direction="-1" ${index===0?'disabled':''} aria-label="${esc(c.name)} 앞으로">↑</button><button class="text-button" data-action="move-character" data-id="${esc(c.id)}" data-direction="1" ${index===chars.length-1?'disabled':''} aria-label="${esc(c.name)} 뒤로">↓</button></div></div><label class="field"><span>표정 적용 방식</span><select data-bind="${prefix}.mode" data-assignment-mode>${[['follow','선택한 표정 순회'],['fixed','특정 표정 고정'],['custom','직접 입력'],['none','외형만 사용']].map(([v,l])=>`<option value="${v}" ${selected(a.mode,v)}>${l}</option>`).join('')}</select></label>${a.mode==='fixed'?`<label class="field"><span>고정할 표정·포즈</span><select data-bind="${prefix}.expressionId"><option value="">프리셋 선택</option>${state.expressions.map(e=>`<option value="${esc(e.id)}" ${selected(a.expressionId,e.id)}>${esc(e.name)}</option>`).join('')}</select></label>`:''}${a.mode==='custom'?field('표정·포즈 Prompt',`${prefix}.prompt`,a.prompt,{type:'textarea',rows:2,placeholder:'예: blush, target#hug'})+field('표정·포즈 Undesired Content',`${prefix}.uc`,a.uc,{type:'textarea',rows:2}):''}${a.mode==='follow'?'<p class="help">이번 배치에서 선택한 표정·포즈가 외형 Prompt 뒤에 붙습니다.</p>':''}${state.multi.useCoords?`<div class="grid-2">${field('가로 위치 (0~1)',`${prefix}.x`,a.x,{type:'number',min:0,max:1,step:0.1})}${field('세로 위치 (0~1)',`${prefix}.y`,a.y,{type:'number',min:0,max:1,step:0.1})}</div><p class="help">왼쪽 / 위 0 · 중앙 0.5 · 오른쪽 / 아래 1</p>`:''}</article>`;}).join('')}</div><p class="help">예: A는 표정 순회, B는 미소 고정. 서로 안는 포즈는 각자의 Prompt에 mutual#hug를 입력할 수 있습니다.</p></div>`;}
function settingsPage() {
  const st=style(),ch=character(),g=state.generation;
  return title('CREATE YOUR CHARACTER','이미지 생성 설정','저장한 프리셋을 조합하고, 필요한 표정을 한 번에 생성하세요.',`<a class="button secondary" href="#/results">생성 결과 보기 ${icon('arrow',16)}</a>`)+
  `<label class="image-import-bar">${icon('image',20)}<span>이미지를 끌어오거나 클릭하여 불러오기<small>메타데이터 · Reference · Vibe Transfer · img2img</small></span><input type="file" id="image-intake" accept="image/png,image/jpeg,image/webp" multiple></label>`+
  `<div class="settings-layout"><div class="settings-main">
    <section class="panel">${sectionHeader('01','그림체','STYLE PRESET')} ${presetSelector('style',state.styles,state.selectedStyle)}
      ${field('Prompt','style.prompt',st.prompt,{type:'textarea',rows:3,placeholder:'그림체, 품질, 배경 등 공통 태그'})}
      ${field('Undesired Content','style.uc',st.uc,{type:'textarea',rows:2,placeholder:'제외할 요소'})}
      <div class="grid-2 compact">${field('Steps','style.steps',st.steps,{type:'number',min:1,max:50,step:1})}${field('Guidance','style.guidance',st.guidance,{type:'number',min:0,max:10,step:0.1})}</div>
      <div class="panel-foot"><span>수정 내용이 선택한 프리셋에 자동 저장됩니다.</span><button class="text-button" data-action="preset-copy" data-kind="style">${icon('copy',14)} 복사하여 저장</button></div>
    </section>
    <section class="panel">${sectionHeader('02','캐릭터','CHARACTER PRESET')}${characterSelection()}<div class="editor-caption">편집할 캐릭터</div>${presetSelector('character',state.characters,state.selectedCharacter)}
      ${field('Prompt','character.prompt',ch.prompt,{type:'textarea',rows:3,placeholder:'캐릭터의 외형, 헤어, 의상 등'})}
      ${field('Undesired Content','character.uc',ch.uc,{type:'textarea',rows:2,placeholder:'캐릭터에서 제외할 요소'})}
      <div class="inline-note">${icon('spark',15)} 표정·포즈 프롬프트가 캐릭터 Prompt 뒤에 추가됩니다.</div>
      ${multiCharacterPanel()}
    </section>
    <section class="panel expression-panel">${sectionHeader('03','표정 & 포즈',`<span id="expression-total">${state.expressions.length}</span> PRESETS`,`<button class="button small secondary" data-action="expression-new">${icon('plus',15)} 프리셋 추가</button>`)}
      <div class="expression-tools"><div class="search-wrap">${icon('search',17)}<input id="expression-search" type="search" placeholder="프리셋 이름, 프롬프트 검색" aria-label="표정 프리셋 검색" value="${esc(search)}"></div><button class="text-button" data-action="select-visible">목록 선택</button><button class="text-button muted" data-action="clear-expressions">선택 해제</button></div>
      <div id="expression-tabs">${expressionTabs()}</div><div id="expression-grid">${expressionGrid()}</div>
      <div class="panel-foot"><span><strong id="selected-count">${state.selectedExpressions.length}</strong>개 선택됨</span><span>선택한 순서대로 생성합니다.</span></div>
    </section>
    <section class="panel">${sectionHeader('04','이미지 입력','OPTIONAL')}
      <p class="section-description">Reference, Vibe Transfer 또는 원본 이미지로 결과를 조절하세요.</p>
      ${imageSection('reference','Reference','캐릭터 · 그림체의 특징을 유지합니다.')}
      ${imageSection('vibe','Vibe Transfer','이미지의 분위기와 색감을 가져옵니다.')}
      ${imageSection('img2img','img2img','원본 이미지를 바탕으로 새롭게 생성합니다.')}
    </section>
  </div><aside class="generation-column"><section class="panel generation-panel"><div class="section-header"><h2>생성 설정</h2>${icon('sliders',18)}</div>
    <label class="field"><span>모델</span><select data-bind="generation.model" id="model">${MODELS.map(([id,name])=>`<option value="${id}" ${selected(g.model,id)}>${name}</option>`).join('')}<option value="custom" ${selected(g.model,'custom')}>모델 직접 입력</option></select></label>
    <label class="field"><span>이미지 형식</span><select data-bind="generation.format"><option value="png" ${selected(g.format,'png')}>PNG</option><option value="webp" ${selected(g.format,'webp')}>WebP</option></select><small>WebP는 생성 후 고품질(95%)로 변환하여 저장합니다.</small></label>
    <div id="custom-model" ${g.model!=='custom'?'hidden':''}>${field('모델명','generation.customModel',g.customModel,{placeholder:'nai-diffusion-…'})}</div>
    <div class="divider"></div><label class="field-label">이미지 크기</label><div class="size-options">${[[1216,832,'가로','landscape'],[832,1216,'세로','portrait'],[1024,1024,'정사각형','square']].map(([w,h,label,shape])=>`<button data-action="size" data-width="${w}" data-height="${h}" class="size-option ${g.width===w&&g.height===h?'chosen':''}"><span class="shape ${shape}"></span><span>${label}</span><small>${w} × ${h}</small></button>`).join('')}</div>
    <div class="dimensions">${field('가로 (px)','generation.width',g.width,{type:'number',min:64,max:2048,step:64})}<span>×</span>${field('세로 (px)','generation.height',g.height,{type:'number',min:64,max:2048,step:64})}</div><p class="help">직접 입력 시 64px 단위로 설정하세요.</p>
    <div class="divider"></div><div class="grid-2">${field('프리셋당 이미지','generation.copies',g.copies,{type:'number',min:1,max:100,step:1})}${field('생성 간격 (초)','generation.interval',g.interval,{type:'number',min:0,max:3600,step:1})}</div>
    ${field('Seed','generation.seed',g.seed,{placeholder:'비워 두면 무작위',help:'고정하면 표정마다 같은 Seed를 사용합니다.'})}
    <details class="advanced"><summary>고급 설정</summary><label class="field"><span>Sampler</span><select data-bind="generation.sampler">${['k_euler_ancestral','k_euler','k_dpmpp_2m','k_dpmpp_2s_ancestral','k_dpmpp_sde','ddim_v3'].map(x=>`<option ${selected(x,g.sampler)}>${x}</option>`).join('')}</select></label><label class="field"><span>Noise schedule</span><select data-bind="generation.schedule">${['karras','exponential','polyexponential','native'].map(x=>`<option ${selected(x,g.schedule)}>${x}</option>`).join('')}</select></label></details>
    <div class="batch-summary"><div><span>선택한 프리셋</span><strong id="summary-presets">${state.selectedExpressions.length}개</strong></div><div><span>총 생성 이미지</span><strong class="accent" id="summary-total">${total()}<small> 장</small></strong></div></div>
    <button class="button primary generate-button" data-action="generate" ${active()?'disabled':''}>${icon('spark')}<span>${active()?'생성 진행 중':'이미지 생성'}</span><span id="generate-count">${total()}</span></button>
    <p class="generate-help">${profile().token?'생성 시 연결한 계정의 크레딧이 사용됩니다.':'API 연결을 먼저 설정해 주세요.'}</p><div id="validation-errors" role="alert"></div>
  </section><div class="recipe-note"><span class="eyebrow">PROMPT RECIPE</span><p>그림체 <span>+</span> 캐릭터 <span>+</span> 표정·포즈</p><button class="text-button" data-action="preview-prompt">조합된 프롬프트 확인 ${icon('arrow',14)}</button></div></aside></div>`;
}
function expressionTabs(){return `<div class="tabs">${['전체',...new Set([...GROUPS,...state.expressions.map(x=>x.group||'기타')])].map(g=>`<button data-action="filter-group" data-group="${esc(g)}" class="${group===g?'active':''}">${esc(g)}<span>${g==='전체'?state.expressions.length:state.expressions.filter(x=>(x.group||'기타')===g).length}</span></button>`).join('')}</div>`;}
function visibleExpressions(){return state.expressions.filter(e=>(group==='전체'||(e.group||'기타')===group)&&`${e.name} ${e.prompt}`.toLowerCase().includes(search.toLowerCase()));}
function expressionGrid(){const list=visibleExpressions();return list.length?`<div class="preset-grid">${list.map(e=>`<div class="expression-card ${state.selectedExpressions.includes(e.id)?'chosen':''}"><label><input type="checkbox" data-expression="${esc(e.id)}" ${checked(state.selectedExpressions.includes(e.id))}><span class="expression-label">${esc(e.name)}<small title="${esc(e.prompt)}">${esc(e.prompt)}</small></span></label><button class="edit-preset" data-action="expression-edit" data-id="${esc(e.id)}" aria-label="${esc(e.name)} 편집" title="편집">···</button></div>`).join('')}</div>`:'<div class="empty-small">일치하는 프리셋이 없습니다.</div>';}
function imageSection(kind,title,desc) {
  const data=state[kind],items=kind==='img2img'?(data.image?[data.image]:[]):data.items;
  return `<div class="image-feature"><div class="feature-heading"><div>${icon('image',20)}<span><strong>${title}</strong><small>${desc}</small></span></div><label class="switch"><input type="checkbox" data-bind="${kind}.enabled" ${checked(data.enabled)} aria-label="${title} 사용"><span></span></label></div><div class="feature-content" ${!data.enabled?'hidden':''}>
  ${kind==='reference'?'<p class="help">V4.5 지원 · V5는 API에서 기능이 지원되는 시점부터 사용 가능합니다. Vibe Transfer와 동시 사용은 지원되지 않습니다.</p>':''}
  ${kind==='vibe'?'<p class="help">최대 16장. V4 이상은 첫 인코딩 시 추가 크레딧이 사용되며, 공식 API 인코딩 결과는 재사용됩니다. V5는 API 지원 여부에 따라 동작합니다.</p>':''}
  <div class="upload-list">${items.map((r,i)=>`<div class="upload-item"><div class="upload-preview"><img src="data:${esc(r.mime)};base64,${esc(r.data)}" alt="${esc(r.name)}"><button data-action="remove-image" data-kind="${kind}" data-id="${esc(r.id)}" aria-label="${esc(r.name)} 제거">${icon('close',14)}</button></div><div class="upload-settings"><strong class="file-name">${esc(r.name)}</strong><small class="muted">${r.width} × ${r.height}</small>${kind==='reference'?`<label class="field"><span>Reference 종류</span><select data-bind="reference.items.${i}.type">${[['character_and_style','캐릭터 & 그림체'],['character','캐릭터'],['style','그림체']].map(([v,l])=>`<option value="${v}" ${selected(r.type,v)}>${l}</option>`).join('')}</select></label><div class="grid-2">${field('Strength',`reference.items.${i}.strength`,r.strength,{type:'number',min:0,max:1,step:0.05})}${field('Fidelity',`reference.items.${i}.fidelity`,r.fidelity,{type:'number',min:0,max:1,step:0.05})}</div>`:kind==='vibe'?`<div class="grid-2">${field('Strength',`vibe.items.${i}.strength`,r.strength,{type:'number',min:0,max:1,step:0.05})}${field('Information extracted',`vibe.items.${i}.information`,r.information,{type:'number',min:0,max:1,step:0.05})}</div>`:''}</div></div>`).join('')}</div>
  <label class="upload-button">${icon('plus',17)} ${kind==='img2img'&&items.length?'원본 바꾸기':'이미지 추가'} <span>PNG · JPG · WebP</span><input type="file" accept="image/png,image/jpeg,image/webp" data-upload="${kind}" ${kind!=='img2img'?'multiple':''}></label>
  ${kind==='img2img'?`<div class="grid-2">${field('변형 강도','img2img.strength',data.strength,{type:'number',min:0,max:1,step:0.05})}${field('Noise','img2img.noise',data.noise,{type:'number',min:0,max:1,step:0.05})}</div><label class="field"><span>원본 크기 맞춤</span><select data-bind="img2img.fit"><option value="contain" ${selected(data.fit,'contain')}>전체 유지 (여백 추가)</option><option value="cover" ${selected(data.fit,'cover')}>화면 채우기 (가장자리 자르기)</option></select></label>`:''}</div></div>`;
}
function resultsPage() {
  const groups=new Map();for(const r of results.slice().sort((a,b)=>b.created.localeCompare(a.created))) {if(galleryFilter!=='all'&&r.expressionId!==galleryFilter)continue;if(!groups.has(r.expressionId))groups.set(r.expressionId,[]);groups.get(r.expressionId).push(r);}
  const options=new Map(results.map(r=>[r.expressionId,r.expressionName]));
  return title('YOUR ASSET LIBRARY','생성 결과','표정과 포즈별로 모인 캐릭터 에셋을 확인하세요.',`<button class="button secondary danger" data-action="delete-all-results" ${!results.length||active()?'disabled':''}>생성 결과 전체 삭제</button><button class="button primary" data-action="download-all" ${!results.length?'disabled':''}>${icon('download',18)} 전체 ZIP 다운로드</button>`)+
  `<div class="results-toolbar"><div><span class="count-pill">${results.length}</span><strong>개의 이미지</strong><span class="muted"> / ${options.size}개 프리셋</span></div><select id="gallery-filter" aria-label="결과 프리셋 필터"><option value="all">모든 표정 & 포즈</option>${[...options].map(([id,name])=>`<option value="${esc(id)}" ${selected(galleryFilter,id)}>${esc(name)}</option>`).join('')}</select></div><div id="result-progress"></div>
  ${!results.length?`<section class="empty-gallery"><div class="empty-icon">${icon('grid',36)}</div><span class="eyebrow">READY WHEN YOU ARE</span><h2>첫 번째 에셋을 기다리고 있어요</h2><p>프리셋을 선택하고 이미지를 생성하면<br>여기에 표정별로 정리됩니다.</p><a class="button secondary" href="#/settings">이미지 생성 설정 ${icon('arrow',16)}</a></section>`:[...groups].map(([id,list])=>`<section class="result-group"><div class="result-group-heading"><div><span class="group-icon">${icon('folder',18)}</span><h2>${esc(list[0].expressionName)}</h2><span class="muted">${list.length}장</span></div><button class="text-button" data-action="download-group" data-id="${esc(id)}">${icon('download',15)} 그룹 ZIP</button></div><div class="result-grid">${list.map(r=>{const url=URL.createObjectURL(r.blob);resultUrls.push(url);return `<article class="result-card"><button class="result-image" data-action="view-image" data-id="${r.id}" aria-label="${esc(r.expressionName)} 이미지 확대"><img src="${url}" alt="${esc(r.characterName)} · ${esc(r.expressionName)}" loading="lazy"></button><div class="result-caption"><div><strong>${esc(r.characterName)}</strong><small>${r.width} × ${r.height} <span>·</span> Seed ${r.seed}</small></div><button class="icon-button" data-action="download-one" data-id="${r.id}" aria-label="이미지 다운로드">${icon('download',18)}</button></div><div class="result-meta"><span>${new Date(r.created).toLocaleString('ko-KR')}</span><button class="text-button danger" data-action="delete-result" data-id="${r.id}">삭제</button></div></article>`;}).join('')}</div></section>`).join('')}`;
}
function connectionPage() {const shared=state.api.provider==='shared';return title('CONNECT YOUR ENGINE','API 연결','이미지를 생성할 서비스를 선택하고 계정을 연결하세요.')+`<div class="narrow"><section class="panel"><div class="provider-options">${[['novelai','NovelAI','공식 이미지 API'],['shared','SharedNAI','계정 로그인']].map(([id,name,desc])=>`<button data-action="provider" data-provider="${id}" class="provider ${selected(state.api.provider,id)?'chosen':''}">${icon('plug',24)}<strong>${name}</strong><small>${desc}</small>${state.api.provider===id?icon('check',17):''}</button>`).join('')}</div>
  ${shared?`${profile().token&&profile().loginSession?`<div class="account-session"><div><strong>${esc(profile().username||'SharedNAI 계정')}</strong><p>로그인 상태가 저장되어 있습니다.</p></div><button class="button secondary" data-action="logout-shared">로그아웃</button></div><button class="button secondary" data-action="check-api">로그인 상태 확인</button>`:''}<form id="login-form" class="account-login"><h2>${profile().loginSession?'다른 계정으로 로그인':'SharedNAI 계정 로그인'}</h2><label class="field"><span>아이디</span><input name="username" autocomplete="username" value="${esc(profile().username||'')}" required></label><label class="field"><span>비밀번호</span><input type="password" name="password" autocomplete="current-password" required></label><p class="help">비밀번호는 저장하지 않습니다. 로그인 상태는 이 브라우저에 유지됩니다.</p><button class="button primary" type="submit">로그인하고 연결</button></form>`:`${field('API 기본 주소','profile.base',profile().base,{help:'기본 주소: https://image.novelai.net'})}${field('API 토큰 (Persistent API Token)','profile.token',profile().token,{type:'password',placeholder:'토큰을 입력해 주세요',help:'이 브라우저에만 저장되며 선택한 API로만 전송됩니다.'})}<div class="connection-actions"><label class="check-label"><input id="show-token" type="checkbox"> 토큰 표시</label><button class="button secondary" data-action="check-api">${icon('plug',17)} 연결 확인</button></div><p class="help token-help">NovelAI의 계정 설정 → Account → Get Persistent API Token에서 발급한 토큰을 입력하세요.</p>`}
  <div id="connection-status" role="status">${apiChecked?'<p class="success-note">연결을 확인했습니다.</p>':''}</div></section><div class="info-card"><h3>내 브라우저 안의 작업실</h3><p>프리셋, 로그인 상태, 생성 이미지는 이 브라우저에 보관됩니다. 다른 기기로 옮길 때는 백업 파일을 사용하세요.</p></div></div>`;}
async function importBackupFile(file){
  if(active())throw Error('생성을 중지한 후 백업을 불러와 주세요.');
  if(!/\.json$/i.test(file.name)&&file.type!=='application/json')throw Error('백업 JSON 파일을 선택해 주세요.');
  if(file.size>150*1024*1024)throw Error('150MB 이하 백업 파일을 선택해 주세요.');
  let data;try{data=JSON.parse(await file.text());}catch{throw Error('백업 JSON 파일을 읽을 수 없습니다. 올바른 백업 파일을 선택해 주세요.');}
  const next=parseBackup(data);
  confirmation('백업 불러오기',`그림체 ${next.styles.length}개, 캐릭터 ${next.characters.length}개, 표정·포즈 ${next.expressions.length}개와 API 설정을 불러옵니다. 현재 설정을 교체할까요?`,async()=>{
    if(active())throw Error('생성을 중지한 후 백업을 불러와 주세요.');
    await saveSettings(next);state=next;apiChecked=false;search='';group='전체';render();toast('백업을 불러왔습니다.');
  });
}
function backupPage(){return title('KEEP YOUR WORK SAFE','백업 & 불러오기','API 연결부터 프롬프트 프리셋까지, 하나의 파일로 보관하세요.')+`<div class="narrow"><section class="panel backup-panel"><div class="large-icon">${icon('download',27)}</div><h2>작업실 설정 백업</h2><p>API 토큰, 그림체, 캐릭터, 표정·포즈, 생성 설정과<br>Reference · Vibe · img2img 입력 이미지를 포함합니다.</p><div class="backup-stats"><span><strong>${state.styles.length}</strong>그림체</span><span><strong>${state.characters.length}</strong>캐릭터</span><span><strong>${state.expressions.length}</strong>표정 & 포즈</span></div><p class="inline-warning">백업에는 API 토큰이 포함됩니다. 다른 사람에게 공유하지 마세요.</p><button class="button primary" data-action="backup">${icon('download',18)} 전체 설정 백업 (.json)</button><p class="help">생성 결과 이미지는 결과 화면의 ZIP 다운로드로 보관하세요.</p></section><section class="panel"><h2>백업 불러오기</h2><p class="section-description">현재 설정과 프리셋을 백업 내용으로 교체합니다.<br>생성 결과 이미지는 유지됩니다.</p><label class="upload-button">${icon('folder',18)} 백업 파일 선택<input id="import-backup" type="file" accept="application/json,.json"></label><p class="help">백업 JSON 파일을 이 화면에 끌어놓아도 됩니다. 내용을 확인한 뒤 불러오기를 확정합니다.</p></section></div>`;}
function render(){document.documentElement.dataset.theme=state.theme;resultUrls.forEach(URL.revokeObjectURL);resultUrls=[];const requested=location.hash.slice(2);route=['settings','results','connection','backup'].includes(requested)?requested:'settings';app.innerHTML=shell(({settings:settingsPage,results:resultsPage,connection:connectionPage,backup:backupPage}[route])());$('.sidebar-bottom').insertAdjacentHTML('afterbegin',themeChooser());updateQueue();updateCounts();}
function updateCounts(){if(route!=='settings')return;$('#selected-count').textContent=state.selectedExpressions.length;$('#summary-presets').textContent=`${batchExpressions(state).length}개 조합`;$('#summary-total').innerHTML=`${total()}<small> 장</small>`;$('#generate-count').textContent=total();}
function renderExpressions(){if(route==='settings'){$('#expression-tabs').innerHTML=expressionTabs();$('#expression-grid').innerHTML=expressionGrid();updateCounts();}}
function openModal(html){modal.innerHTML=html;modal.showModal();}
function modalHeading(title){return `<div class="modal-heading"><h2>${title}</h2><button class="icon-button" data-action="close-modal" aria-label="닫기">${icon('close')}</button></div>`;}
function imageIntake(files){
  if(!files.length)return;pendingImages=[...files];
  if(pendingImages.length>16)throw Error('한 번에 16장까지 불러올 수 있습니다.');
  if(modal.open)modal.close();
  openModal(`${modalHeading('이미지를 어떻게 사용할까요?')}<p class="help">${esc(pendingImages[0].name)}${pendingImages.length>1?` 외 ${pendingImages.length-1}장`:''}</p><div class="image-intake-options">${[['metadata','메타데이터','저장된 Prompt·UC·캐릭터·생성 설정 가져오기'],['reference','Reference','캐릭터와 그림체의 특징 참고'],['vibe','Vibe Transfer','색감과 분위기 참고'],['img2img','img2img','원본을 바탕으로 이미지 생성']].map(([kind,title,desc])=>`<button data-action="intake-choice" data-kind="${kind}" ${pendingImages.length>1&&['metadata','img2img'].includes(kind)?'disabled':''}>${icon(kind==='metadata'?'sliders':'image',23)}<span><strong>${title}</strong><small>${desc}</small></span>${icon('arrow',15)}</button>`).join('')}</div>${pendingImages.length>1?'<p class="help">메타데이터와 img2img는 이미지를 한 장씩 불러와 주세요.</p>':''}`);
}
async function useIncomingImages(kind){
  const files=pendingImages.slice();if(!files.length)throw Error('이미지를 다시 선택해 주세요.');
  if(kind==='metadata'){
    if(files.length!==1)throw Error('메타데이터는 한 장씩 불러와 주세요.');
    const data=await readMetadata(files[0]);
    openModal(`${modalHeading('이미지 메타데이터')}<p class="help">${esc(files[0].name)} · 새 프리셋으로 추가합니다. 기존 프리셋과 API 연결은 유지됩니다.</p><dl class="metadata-summary"><div><dt>모델</dt><dd>${esc(data.model||'확인되지 않음 · 현재 모델 유지')}</dd></div><div><dt>캐릭터</dt><dd>${data.characters.length||'단일 Prompt'}${data.characters.length?'명':''}</dd></div><div><dt>크기 / Steps / Guidance</dt><dd>${data.settings.width||'—'} × ${data.settings.height||'—'} / ${data.settings.steps??'—'} / ${data.settings.guidance??'—'}</dd></div></dl><h3>Prompt</h3><pre>${esc(data.prompt)}</pre><h3>Undesired Content</h3><pre>${esc(data.uc||'(비어 있음)')}</pre>${data.characters.map((c,i)=>`<h3>캐릭터 ${i+1}</h3><pre>${esc(c.prompt)}</pre>`).join('')}<div class="modal-actions"><button class="button secondary" data-action="close-modal">취소</button><button class="button primary" id="apply-metadata">메타데이터 불러오기</button></div>`);
    $('#apply-metadata').onclick=async()=>{try{state=applyMetadata(state,data,files[0].name);await flush();modal.close();pendingImages=[];location.hash='/settings';render();toast('메타데이터를 새 프리셋으로 불러왔습니다.');}catch(e){toast(e.message,true);}};
    return;
  }
  if(!['reference','vibe','img2img'].includes(kind))throw Error('이미지 사용 방식을 선택해 주세요.');
  if(kind!=='img2img'&&state[kind].items.length+files.length>16)throw Error('이미지는 최대 16장입니다.');
  const images=[];for(const file of files)images.push(await readImage(file));
  if(kind==='img2img')state.img2img.image=images[0];else state[kind].items.push(...images);
  state[kind].enabled=true;if(kind==='reference')state.vibe.enabled=false;if(kind==='vibe')state.reference.enabled=false;
  await flush();modal.close();pendingImages=[];location.hash='/settings';render();toast('이미지를 불러왔습니다.');
}
function editPreset(kind,id=null,copy=false) {
  const list=kind==='style'?state.styles:kind==='character'?state.characters:state.expressions,item=list.find(x=>x.id===id);
  const isNew=!item||copy;
  openModal(`${modalHeading(`${kind==='style'?'그림체':kind==='character'?'캐릭터':'표정 & 포즈'} 프리셋 ${isNew?'추가':'편집'}`)}<form id="preset-form" data-kind="${kind}" data-id="${isNew?'':esc(id)}"><label class="field"><span>이름</span><input name="name" value="${esc(item?item.name+(copy?' 복사':''):'')}" required maxlength="80"></label>${kind==='expression'?`<label class="field"><span>분류</span><input name="group" list="group-options" value="${esc(item?.group||'기본 감정')}" required><datalist id="group-options">${GROUPS.map(x=>`<option>${x}</option>`).join('')}</datalist></label>`:''}<label class="field"><span>Prompt</span><textarea name="prompt" rows="4" spellcheck="false">${esc(item?.prompt||'')}</textarea></label><label class="field"><span>Undesired Content</span><textarea name="uc" rows="2" spellcheck="false">${esc(item?.uc||'')}</textarea></label>${kind==='style'?`<div class="grid-2"><label class="field"><span>Steps</span><input name="steps" type="number" min="1" max="50" value="${item?.steps||28}" required></label><label class="field"><span>Guidance</span><input name="guidance" type="number" min="0" max="10" step="0.1" value="${item?.guidance??5}" required></label></div>`:''}<div class="modal-actions">${!isNew?`<button type="button" class="text-button danger" data-action="delete-preset" data-kind="${kind}" data-id="${esc(id)}">프리셋 삭제</button>`:'<span></span>'}<button class="button primary" type="submit">${icon('save',17)} 프리셋 저장</button></div></form>`);
}
function confirmation(title,body,action){openModal(`${modalHeading(title)}<p class="confirm-body">${body}</p><div class="modal-actions"><button class="button secondary" data-action="close-modal">취소</button><button class="button primary" id="confirm-action">확인</button></div>`);$('#confirm-action').onclick=async()=>{try{await action();modal.close();}catch(e){toast(e.message,true);}};}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.hidden=true;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function resultFilename(r){return `${safeName(r.expressionName)}_${safeName(r.characterName)}_${r.seed}_${r.id.slice(0,8)}.${r.blob.type==='image/webp'?'webp':r.blob.type==='image/jpeg'?'jpg':'png'}`;}
async function zipResults(list){
  if(!list.length)return;if(!globalThis.fflate)throw Error('ZIP 라이브러리를 불러오지 못했습니다.');
  toast('ZIP 파일을 준비하고 있습니다…');const files={};
  for(const r of list) files[`${safeName(r.expressionName)}_${r.expressionId.slice(0,8)}/${resultFilename(r)}`]=new Uint8Array(await r.blob.arrayBuffer());
  files['generation-info.json']=new TextEncoder().encode(JSON.stringify(list.map(({blob,...r})=>r),null,2));
  const bytes=await new Promise((resolve,reject)=>globalThis.fflate.zip(files,{level:0},(error,data)=>error?reject(error):resolve(data)));
  download(new Blob([bytes],{type:'application/zip'}),`asset-studio-${new Date().toISOString().slice(0,10)}.zip`);toast(`${list.length}개 이미지 ZIP 다운로드를 시작했습니다.`);
}
async function viewImage(id){const r=results.find(x=>x.id===id),url=URL.createObjectURL(r.blob);openModal(`${modalHeading(esc(r.expressionName))}<img class="lightbox-image" src="${url}" alt="${esc(r.expressionName)}"><div class="image-detail"><p>${esc(r.model)} · ${r.width} × ${r.height} · Seed ${r.seed}</p><details><summary>생성 프롬프트</summary><pre>${esc(r.prompt)}</pre><strong>Undesired Content</strong><pre>${esc(r.uc)}</pre></details></div><div class="modal-actions"><span>${esc(r.characterName)}</span><button class="button primary" data-action="download-one" data-id="${r.id}">${icon('download',18)} 다운로드</button></div>`);modal.addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});}
function updateQueue(){
  const bar=$('#queue-bar');if(!bar)return;
  if(queue.phase==='idle'){bar.innerHTML='';return;}
  const labels={preparing:'생성 준비 중',running:`${queue.job?.name||''} 생성 중`,waiting:`다음 이미지까지 ${Math.max(0,Math.ceil((queue.until-Date.now())/1000))}초`,error:'생성이 일시 중단되었습니다',done:'생성이 완료되었습니다',stopped:'생성을 중지했습니다'};
  const status=queue.message||labels[queue.phase]||'';
  bar.innerHTML=`<div class="queue-status ${queue.phase==='error'?'has-error':''}"><div class="queue-main"><span class="queue-spinner ${active()&&queue.phase!=='error'?'spinning':''}">${icon(queue.phase==='done'?'check':'spark',18)}</span><div><strong>${esc(status)}</strong><small>${queue.index} / ${queue.total} 완료 ${queue.error?' · '+esc(queue.error.message):''}</small></div></div><div class="queue-actions">${queue.phase==='error'&&active()?'<button class="button small secondary" data-action="retry">실패 항목 다시 시도</button>':''}${active()?'<button class="button small secondary" data-action="stop">중지</button>':'<button class="icon-button" data-action="dismiss-queue" aria-label="상태 닫기">'+icon('close',18)+'</button>'}${route!=='results'?'<a class="button small primary" href="#/results">결과 보기</a>':''}</div><div class="queue-progress" style="width:${queue.total?queue.index/queue.total*100:0}%"></div></div>`;
}
async function startGeneration(){
  if(active())return;
  const errors=validate(state);if(errors.length){if($('#validation-errors'))$('#validation-errors').innerHTML=errors.map(x=>`<p>${esc(x)}</p>`).join('');toast(errors[0],true);return;}
  const inputs=[...app.querySelectorAll('input[type=number]')];if(inputs.some(x=>!x.reportValidity()))return;
  if(!navigator.locks)throw Error('여러 탭의 중복 생성을 방지하려면 최신 Chrome, Edge, Firefox를 사용해 주세요.');
  await navigator.locks.request('asset-studio-generation',{ifAvailable:true},async lock=>{
    if(!lock)throw Error('다른 탭에서 이미지 생성이 진행 중입니다.');
    await flush();const snapshot=structuredClone(state),jobs=[];controller=new AbortController();const signal=controller.signal;
    for(const e of batchExpressions(snapshot)){for(let n=0;n<snapshot.generation.copies;n++)jobs.push({...e,seed:snapshot.generation.seed===''?crypto.getRandomValues(new Uint32Array(1))[0]:Number(snapshot.generation.seed),copy:n});}
    queue={phase:'preparing',index:0,total:jobs.length};render();
    try {
      const prepared=await prepare(snapshot,signal,message=>{queue.message=message;updateQueue();});queue.message='';
      await runJobs(jobs,{signal,interval:snapshot.generation.interval,
        onUpdate:q=>{queue=q;updateQueue();},
        onFailure:async()=>new Promise(resolve=>{retryResolve=resolve;signal.addEventListener('abort',()=>resolve(false),{once:true});}),
        execute:async(job)=>{
          const images=await generate(snapshot,job,job.seed,prepared,signal),p=prompts(snapshot,job);
          for(const image of images){const r={id:uid(),blob:image.blob,expressionId:job.id,expressionName:job.name,characterName:activeCharacters(snapshot).map(c=>c.name).join(' + '),characters:p.cast,styleName:snapshot.styles.find(x=>x.id===snapshot.selectedStyle).name,seed:image.seed??job.seed,width:image.width,height:image.height,model:modelOf(snapshot),prompt:p.full,uc:p.uc,created:new Date().toISOString()};
            results.push(r);
            try{await db('results','put',r);}catch{render();toast('생성 이미지를 영구 저장하지 못했습니다. 결과 화면에서 지금 다운로드해 주세요.',true);throw Error('이미지 저장 실패: 생성 결과를 다운로드한 후 배치를 중지해 주세요. 다시 시도하면 새로 생성됩니다.');}
          }
          if(route==='results')render();else {const count=$('.nav-count');if(count)count.textContent=results.length;}
        }
      });
      toast(`${jobs.length}개 작업의 이미지 생성이 완료되었습니다.`);
    } catch(error){queue={...queue,phase:signal.aborted?'stopped':'error',message:'',error:signal.aborted?null:error};if(!signal.aborted)toast(error.message,true);}
    finally {controller=null;retryResolve=null;render();}
  });
}
const actions={
  'theme':el=>{state.theme=el.dataset.theme;persist();render();},
  'focus-character':el=>{state.selectedCharacter=el.dataset.id;persist();render();},
  'move-character':el=>{const at=state.selectedCharacters.indexOf(el.dataset.id),next=at+Number(el.dataset.direction);if(at<0||next<0||next>=state.selectedCharacters.length)return;[state.selectedCharacters[at],state.selectedCharacters[next]]=[state.selectedCharacters[next],state.selectedCharacters[at]];persist();render();},
  'intake-choice':async el=>{el.disabled=true;try{await useIncomingImages(el.dataset.kind);}finally{el.disabled=false;}},
  'logout-shared':async()=>{Object.assign(state.api.profiles.shared,{token:'',username:'',loginSession:false});apiChecked=false;await flush();render();toast('로그아웃했습니다.');},
  'generate':startGeneration,
  'stop':()=>{controller?.abort(new DOMException('사용자가 중지했습니다.','AbortError'));retryResolve?.(false);toast('다음 생성을 중지했습니다. 이미 전송한 요청은 서버에서 완료될 수 있습니다.');},
  'retry':()=>{retryResolve?.(true);retryResolve=null;},'dismiss-queue':()=>{queue={phase:'idle'};updateQueue();},
  'size':el=>{state.generation.width=Number(el.dataset.width);state.generation.height=Number(el.dataset.height);persist();render();},
  'filter-group':el=>{group=el.dataset.group;renderExpressions();},
  'select-visible':()=>{state.selectedExpressions=[...new Set([...state.selectedExpressions,...visibleExpressions().map(e=>e.id)])];persist();renderExpressions();},
  'clear-expressions':()=>{state.selectedExpressions=[];persist();renderExpressions();},
  'preset-new':el=>editPreset(el.dataset.kind),
  'preset-edit':el=>editPreset(el.dataset.kind,el.dataset.kind==='style'?state.selectedStyle:state.selectedCharacter),
  'preset-copy':el=>editPreset(el.dataset.kind,el.dataset.kind==='style'?state.selectedStyle:state.selectedCharacter,true),
  'expression-new':()=>editPreset('expression'),'expression-edit':el=>editPreset('expression',el.dataset.id),
  'close-modal':()=>modal.close(),
  'delete-preset':el=>{
    const kind=el.dataset.kind,id=el.dataset.id,key=kind==='style'?'styles':kind==='character'?'characters':'expressions';
    if(state[key].length===1)throw Error('마지막 프리셋은 삭제할 수 없습니다.');
    modal.close();confirmation('프리셋 삭제','선택한 프리셋을 삭제할까요?',async()=>{state[key]=state[key].filter(x=>x.id!==id);if(kind==='expression'){state.selectedExpressions=state.selectedExpressions.filter(x=>x!==id);for(const a of Object.values(state.assignments))if(a.expressionId===id){a.expressionId='';a.mode='none';}}else {const selection=kind==='style'?'selectedStyle':'selectedCharacter';if(state[selection]===id)state[selection]=state[key][0].id;if(kind==='character'){state.selectedCharacters=state.selectedCharacters.filter(x=>x!==id);delete state.assignments[id];}}await flush();render();});
  },
  'provider':async el=>{state.api.provider=el.dataset.provider;apiChecked=false;await flush();render();},
  'check-api':async el=>{el.disabled=true;el.textContent='연결 확인 중…';try {await connect(state);await flush();apiChecked=true;const status=$('#connection-status');if(status)status.innerHTML='<p class="success-note">API 인증 확인 완료 · 생성 가능 여부는 모델·잔액·계정 권한에 따라 달라집니다.</p>';toast('API 연결을 확인했습니다.');} finally {el.disabled=false;el.textContent='연결 확인';}},
  'remove-image':el=>{const k=el.dataset.kind;if(k==='img2img')state[k].image=null;else state[k].items=state[k].items.filter(x=>x.id!==el.dataset.id);persist();render();},
  'preview-prompt':()=>{const e=batchExpressions(state)[0];if(!e)throw Error('표정·포즈를 먼저 선택해 주세요.');const p=prompts(state,e);openModal(`${modalHeading('프롬프트 조합 미리보기')}<p class="help">${esc(e.name)} 기준 · V4 이상에서는 캐릭터별로 프롬프트를 분리해 전달합니다.</p><h3>기본 Prompt</h3><pre>${esc(p.base||'(비어 있음)')}</pre>${p.cast.map(c=>`<h3>${esc(c.name)}</h3><pre>${esc(c.prompt)}</pre><small>Undesired Content</small><pre>${esc(c.uc||'(비어 있음)')}</pre>`).join('')}<h3>기본 Undesired Content</h3><pre>${esc(p.baseUC||'(비어 있음)')}</pre>`);},
  'backup':async()=>{await flush();download(new Blob([JSON.stringify({format:'asset-studio-backup',version:1,exportedAt:new Date().toISOString(),settings:state},null,2)],{type:'application/json'}),`asset-studio-backup-${new Date().toISOString().slice(0,10)}.json`);toast('설정 백업 다운로드를 시작했습니다.');},
  'download-one':el=>{const r=results.find(x=>x.id===el.dataset.id);download(r.blob,resultFilename(r));},
  'download-all':()=>zipResults(results),'download-group':el=>zipResults(results.filter(x=>x.expressionId===el.dataset.id)),
  'view-image':el=>viewImage(el.dataset.id),
  'delete-all-results':()=>{if(active())throw Error('생성을 중지한 후 전체 삭제해 주세요.');confirmation('생성 결과 전체 삭제',`저장된 이미지 ${results.length}장을 모두 삭제할까요? 되돌릴 수 없습니다. 필요한 이미지는 먼저 ZIP으로 다운로드해 주세요.`,async()=>{if(active())throw Error('생성을 중지한 후 전체 삭제해 주세요.');await db('results','clear');results=[];render();toast('생성 결과를 모두 삭제했습니다.');});},
  'delete-result':el=>confirmation('이미지 삭제','이 브라우저에 저장된 이미지를 삭제할까요?',async()=>{await db('results','delete',el.dataset.id);results=results.filter(x=>x.id!==el.dataset.id);render();}),
};
document.addEventListener('click',async e=>{const el=e.target.closest('[data-action]');if(!el||el.disabled)return;try{await actions[el.dataset.action]?.(el);}catch(error){toast(error.message,true);}});
document.addEventListener('input',e=>{
  const el=e.target;
  if(el.id==='expression-search'){search=el.value;$('#expression-grid').innerHTML=expressionGrid();return;}
  if(el.dataset.bind){bindSet(el.dataset.bind,el.type==='checkbox'?el.checked:el.type==='number'?Number(el.value):el.value);if(el.dataset.bind.startsWith('profile.'))apiChecked=false;persist();updateCounts();
    if(['generation.width','generation.height'].includes(el.dataset.bind))document.querySelectorAll('.size-option').forEach(b=>b.classList.toggle('chosen',+b.dataset.width===state.generation.width&&+b.dataset.height===state.generation.height));
  }
});
document.addEventListener('change',async e=>{const el=e.target;try{
  if(el.dataset.characterPick){const id=el.dataset.characterPick;state.selectedCharacters=el.checked?[...new Set([...state.selectedCharacters,id])]:state.selectedCharacters.filter(x=>x!==id);if(el.checked)state.selectedCharacter=id;persist();render();}
  if(el.hasAttribute('data-assignment-mode')||el.dataset.bind==='multi.useCoords'){persist();render();}
  if(el.id==='image-intake'){imageIntake([...el.files]);el.value='';}
  if(el.dataset.expression){const id=el.dataset.expression;state.selectedExpressions=el.checked?[...new Set([...state.selectedExpressions,id])]:state.selectedExpressions.filter(x=>x!==id);persist();renderExpressions();}
  if(el.dataset.select){state[el.dataset.select==='style'?'selectedStyle':'selectedCharacter']=el.value;persist();render();}
  if(el.dataset.bind==='generation.model'){$('#custom-model').hidden=el.value!=='custom';}
  if(el.dataset.bind?.endsWith('.enabled'))el.closest('.image-feature').querySelector('.feature-content').hidden=!el.checked;
  if(el.id==='show-token')$('#field-profile-token').type=el.checked?'text':'password';
  if(el.id==='gallery-filter'){galleryFilter=el.value;render();}
  if(el.dataset.upload){const kind=el.dataset.upload,files=[...el.files];if(kind!=='img2img'&&state[kind].items.length+files.length>16)throw Error('이미지는 최대 16장까지 추가할 수 있습니다.');const images=[];for(const f of files)images.push(await readImage(f));if(kind==='img2img')state.img2img.image=images[0]||null;else state[kind].items.push(...images);await flush();render();}
  if(el.id==='import-backup'&&el.files[0]){await importBackupFile(el.files[0]);el.value='';}
}catch(error){toast(error.message,true);if(el.type==='file')el.value='';}});
document.addEventListener('submit',async e=>{if(!['preset-form','login-form'].includes(e.target.id))return;e.preventDefault();const form=e.target,button=form.querySelector('[type=submit]');button.disabled=true;try{
  const data=new FormData(form);
  if(form.id==='preset-form') {const kind=form.dataset.kind,key=kind==='style'?'styles':kind==='character'?'characters':'expressions';const item={id:form.dataset.id||uid(),name:data.get('name').trim(),prompt:data.get('prompt'),uc:data.get('uc')};if(!item.name)throw Error('프리셋 이름을 입력해 주세요.');if(kind==='style')Object.assign(item,{steps:Number(data.get('steps')),guidance:Number(data.get('guidance'))});if(kind==='expression')item.group=data.get('group').trim()||'기타';const index=state[key].findIndex(x=>x.id===item.id);if(index>=0)state[key][index]=item;else state[key].push(item);if(kind==='expression'&&index<0)state.selectedExpressions.push(item.id);else if(kind!=='expression')state[kind==='style'?'selectedStyle':'selectedCharacter']=item.id;if(kind==='character'&&index<0)state.selectedCharacters.push(item.id);await flush();modal.close();render();toast('프리셋을 저장했습니다.');}
  if(form.id==='login-form'){const target=state.api.profiles.shared,username=String(data.get('username')).trim(),token=await login(target,username,data.get('password'));Object.assign(target,{token,username,loginSession:true});await flush();apiChecked=true;form.reset();render();toast('로그인했습니다.');}
}catch(error){toast(error.message,true);}finally{button.disabled=false;}});
window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});
let dragDepth=0;
const isBackupDrop=()=>location.hash.replace(/\/+$/,'')==='#/backup'||Boolean(document.querySelector('#import-backup'));
const isFileDrag=e=>Array.from(e.dataTransfer?.types||[]).includes('Files');
document.addEventListener('dragenter',e=>{if(isFileDrag(e)){e.preventDefault();dragDepth++;document.body.dataset.dropKind=isBackupDrop()?'backup':'image';document.body.classList.add('dragging-image');}});
document.addEventListener('dragover',e=>{if(isFileDrag(e)){e.preventDefault();document.body.dataset.dropKind=isBackupDrop()?'backup':'image';document.body.classList.add('dragging-image');e.dataTransfer.dropEffect='copy';}});
document.addEventListener('dragleave',e=>{if(isFileDrag(e)&&--dragDepth<=0){dragDepth=0;document.body.classList.remove('dragging-image');}});
document.addEventListener('drop',async e=>{if(!isFileDrag(e))return;e.preventDefault();dragDepth=0;document.body.classList.remove('dragging-image');try{if(isBackupDrop()){const backups=[...e.dataTransfer.files];if(backups.length!==1)throw Error('백업 JSON 파일을 한 개씩 끌어와 주세요.');await importBackupFile(backups[0]);return;}const files=[...e.dataTransfer.files].filter(f=>/^image\//.test(f.type)||/\.(png|jpe?g|webp)$/i.test(f.name));if(!files.length)throw Error('PNG, JPEG, WebP 이미지 파일을 끌어와 주세요.');imageIntake(files);}catch(error){toast(error.message,true);}});
window.addEventListener('beforeunload',e=>{if(active()){e.preventDefault();e.returnValue='';}});
modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)modal.close();}});
setInterval(()=>{if(queue.phase==='waiting')updateQueue();},500);
try {
  const saved=(await db('settings','get','main'))?.value;state=saved?migrateSettings(saved):defaults();results=await db('results','getAll');render();if(saved)await flush();
  const context=document.modelContext;
  if(context?.registerTool){const lifecycle=new AbortController();window.addEventListener('pagehide',()=>lifecycle.abort(),{once:true});Promise.resolve(context.registerTool({name:'list_asset_presets',description:'Read saved style, character, and expression preset names. Does not expose API tokens.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:()=>({styles:state.styles.map(({id,name})=>({id,name})),characters:state.characters.map(({id,name})=>({id,name})),expressions:state.expressions.map(({id,name,group})=>({id,name,group}))})},{signal:lifecycle.signal})).catch(()=>{});}
}catch(error){app.innerHTML=`<div class="boot"><h1>브라우저 저장소를 열지 못했습니다.</h1><p>최신 브라우저에서 로컬 저장소 사용을 허용한 후 다시 열어 주세요.</p><p>${esc(error.message)}</p></div>`;}
