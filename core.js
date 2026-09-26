export const MODELS = [
  ['nai-diffusion-5-full', 'NovelAI Diffusion V5 Full'],
  ['nai-diffusion-5-curated', 'NovelAI Diffusion V5 Curated'],
  ['nai-diffusion-4-5-full', 'NovelAI Diffusion V4.5 Full'],
  ['nai-diffusion-4-5-curated', 'NovelAI Diffusion V4.5 Curated'],
  ['nai-diffusion-4-full', 'NovelAI Diffusion V4 Full'],
  ['nai-diffusion-4-curated-preview', 'NovelAI Diffusion V4 Curated'],
  ['nai-diffusion-3', 'NovelAI Diffusion Anime V3'],
  ['nai-diffusion-furry-3', 'NovelAI Diffusion Furry V3'],
  ['nai-diffusion-2', 'NovelAI Diffusion Anime V2'],
];
export const GROUPS = ['기본 감정', '섬세한 감정', '포즈'];
export const SHARED_BASE = 'https://sharednai5.pro/api';
export const uid = () => crypto.randomUUID();
const expressions = [
  ['평온','neutral expression, relaxed','기본 감정'],['미소','gentle smile','기본 감정'],
  ['활짝 웃음','laughing, open mouth, happy','기본 감정'],['화남','angry, frown','기본 감정'],
  ['슬픔','sad, downcast eyes','기본 감정'],['울음','crying, tears','기본 감정'],
  ['놀람','surprised, wide-eyed, open mouth','기본 감정'],['무표정','expressionless','기본 감정'],
  ['수줍음','shy, blush, looking away','섬세한 감정'],['당황','embarrassed, blush, sweatdrop','섬세한 감정'],
  ['자신만만','confident smile, smug','섬세한 감정'],['삐침','pout, puffed cheeks','섬세한 감정'],
  ['걱정','worried, furrowed brow','섬세한 감정'],['의심','suspicious, raised eyebrow','섬세한 감정'],
  ['지침','tired, half-closed eyes','섬세한 감정'],['졸림','sleepy, yawning','섬세한 감정'],
  ['윙크','wink, smile','섬세한 감정'],['결의','determined, serious','섬세한 감정'],
  ['손 흔들기','waving, one hand raised, smile','포즈'],['팔짱','crossed arms','포즈'],
  ['생각 중','hand on own chin, thinking','포즈'],['손가락 하트','finger heart, smile','포즈'],
  ['브이','v sign, smile','포즈'],['가리키기','pointing, outstretched arm','포즈'],
  ['인사','bowing, hands together','포즈'],['허리에 손','hands on hips','포즈'],
  ['어깨 으쓱','shrugging, palms up','포즈'],['응원','fist pump, cheering, smile','포즈'],
];
export function defaults() {
  return {
    schema: 2,theme:'dark',
    api: {provider:'novelai', profiles:{novelai:{base:'https://image.novelai.net',token:''},shared:{base:SHARED_BASE,token:'',username:'',loginSession:false}}},
    styles:[{id:'style-default',name:'새 그림체',prompt:'',uc:'',steps:28,guidance:5}],
    characters:[{id:'char-default',name:'새 캐릭터',prompt:'',uc:''}],
    expressions: expressions.map(([name,prompt,group],i)=>({id:`exp-${i}`,name,prompt,uc:'',group})),
    selectedStyle:'style-default',selectedCharacter:'char-default',selectedCharacters:['char-default'],assignments:{},multi:{scene:'',useCoords:false},selectedExpressions:['exp-0','exp-1','exp-3','exp-4','exp-6','exp-8'],
    generation:{format:'png',model:'nai-diffusion-4-5-full',customModel:'',width:832,height:1216,interval:10,copies:1,seed:'',sampler:'k_euler_ancestral',schedule:'karras'},
    reference:{enabled:false,items:[]},vibe:{enabled:false,items:[]},img2img:{enabled:false,image:null,strength:0.7,noise:0,fit:'contain'},
  };
}
export function migrateSettings(raw) {
  const s=structuredClone(raw);
  if(!s.schema||s.schema<2){
    const st=s.styles?.find(x=>x.id==='style-default');
    if(st?.prompt==='masterpiece, best quality, very aesthetic, clean lineart, simple background, white background, upper body, looking at viewer')st.prompt='';
    if(st?.uc==='lowres, bad anatomy, bad hands, text, watermark, blurry, worst quality, low quality')st.uc='';
    if(st?.name==='클린 애니메이션')st.name='새 그림체';
    const c=s.characters?.find(x=>x.id==='char-default');if(c?.prompt==='1girl, solo, silver hair, blue eyes, long hair, white shirt')c.prompt='';
    // Previously pasted SharedNAI tokens must be replaced by a real account login.
    if(s.api?.profiles?.shared)Object.assign(s.api.profiles.shared,{token:'',username:'',loginSession:false});
  }
  if(s.generation)s.generation.format??='png';
  s.schema=2;s.theme=['dark','beige','pink'].includes(s.theme)?s.theme:'dark';
  s.selectedCharacters??=[s.selectedCharacter];s.assignments??={};s.multi??={scene:'',useCoords:false};
  if(s.api?.profiles?.shared)s.api.profiles.shared.base=SHARED_BASE;
  return s;
}
export const activeCharacters=s=>(s.selectedCharacters||[s.selectedCharacter]).map(id=>s.characters.find(c=>c.id===id)).filter(Boolean);
export const assignmentFor=(s,id)=>s.assignments?.[id]||{mode:'follow',expressionId:'',prompt:'',uc:'',x:0.5,y:0.5};
export const batchExpressions=s=>{
  const chars=activeCharacters(s);
  return chars.length>1&&chars.every(c=>assignmentFor(s,c.id).mode!=='follow')?[{id:'fixed-composition',name:'캐릭터별 고정 조합',prompt:'',uc:''}]:s.selectedExpressions.map(id=>s.expressions.find(e=>e.id===id)).filter(Boolean);
};
export const modelOf = s => s.generation.model==='custom' ? s.generation.customModel.trim() : s.generation.model;
export const modern = model => /diffusion-[45]/.test(model);
export const joinPrompt = (...parts) => parts.map(x=>(x||'').trim()).filter(Boolean).join(', ');
export function prompts(s,e) {
  const style=s.styles.find(x=>x.id===s.selectedStyle),chars=activeCharacters(s),isMulti=chars.length>1;
  const cast=chars.map(c=>{const a=assignmentFor(s,c.id);let expression=e;if(isMulti){if(a.mode==='fixed')expression=s.expressions.find(x=>x.id===a.expressionId)||{prompt:'',uc:''};if(a.mode==='custom')expression={prompt:a.prompt,uc:a.uc};if(a.mode==='none')expression={prompt:'',uc:''};}return {id:c.id,name:c.name,prompt:joinPrompt(c.prompt,expression.prompt),uc:joinPrompt(c.uc,expression.uc),x:a.x??0.5,y:a.y??0.5};});
  const base=joinPrompt(style?.prompt,isMulti?s.multi?.scene:'');
  return {base,cast,character:cast[0]?.prompt||'',uc:joinPrompt(style?.uc,...cast.map(c=>c.uc)),characterUC:cast[0]?.uc||'',baseUC:style?.uc||'',full:joinPrompt(base,...cast.map(c=>c.prompt))};
}
export function validate(s, needToken=true) {
  const errors=[],g=s.generation,m=modelOf(s),style=s.styles.find(x=>x.id===s.selectedStyle);
  if(!['png','webp'].includes(g.format??'png'))errors.push('이미지 형식은 PNG 또는 WebP를 선택해 주세요.');
  if(!['novelai','shared'].includes(s.api.provider)) errors.push('API 제공자를 선택해 주세요.');
  if(needToken && !s.api.profiles[s.api.provider]?.token.trim()) errors.push('API 연결에서 토큰을 입력하거나 로그인해 주세요.');
  if(needToken&&s.api.provider==='shared'&&!s.api.profiles.shared.loginSession)errors.push('SharedNAI 계정으로 로그인해 주세요.');
  try { const u=new URL(s.api.profiles[s.api.provider].base); if(u.protocol!=='https:' && !(u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname))) throw Error(); if(u.username||u.password||u.search||u.hash) throw Error(); } catch {errors.push('API 주소는 HTTPS 기본 주소여야 합니다. 로컬 서버는 HTTP도 가능합니다.');}
  if(!m) errors.push('모델명을 입력해 주세요.');
  if(!style) errors.push('그림체 프리셋을 선택해 주세요.');
  const cast=activeCharacters(s);
  if(!cast.length||cast.length!==s.selectedCharacters.length||new Set(s.selectedCharacters).size!==s.selectedCharacters.length)errors.push('캐릭터를 하나 이상 선택해 주세요.');
  if(cast.length>1&&!modern(m))errors.push('캐릭터별 프롬프트 분리는 V4 이상 모델을 선택해 주세요.');
  if(cast.length>(m.includes('diffusion-5')?22:6))errors.push('이 모델의 캐릭터 수 제한을 초과했습니다. V4·V4.5는 6명, V5는 22명까지 지원합니다.');
  if(!batchExpressions(s).length||!s.selectedExpressions.every(id=>s.expressions.some(e=>e.id===id))) errors.push('표정·포즈를 하나 이상 선택해 주세요.');
  if(cast.length>1)for(const c of cast){const a=assignmentFor(s,c.id);if(!['follow','fixed','custom','none'].includes(a.mode))errors.push('캐릭터별 표정 적용 방식을 선택해 주세요.');if(a.mode==='fixed'&&!s.expressions.some(e=>e.id===a.expressionId))errors.push(`${c.name}의 고정 표정을 선택해 주세요.`);if(![a.x??0.5,a.y??0.5].every(n=>Number.isFinite(n)&&n>=0&&n<=1))errors.push('캐릭터 위치는 0~1 사이로 입력해 주세요.');}
  if(![g.width,g.height].every(n=>Number.isInteger(n)&&n>=64&&n<=2048&&n%64===0)||g.width*g.height>3145728) errors.push('크기는 64~2048의 64 배수, 총 3,145,728픽셀 이하로 설정해 주세요.');
  if(!Number.isInteger(g.copies)||g.copies<1||g.copies>100) errors.push('프리셋당 생성 수는 1~100장입니다.');
  if(!Number.isFinite(g.interval)||g.interval<0||g.interval>3600) errors.push('생성 간격은 0~3600초입니다.');
  if(g.seed!==''&&(!/^\d+$/.test(String(g.seed))||Number(g.seed)>4294967295)) errors.push('Seed는 0~4294967295 또는 빈칸으로 입력해 주세요.');
  if(style&&(!Number.isInteger(style.steps)||style.steps<1||style.steps>50||!Number.isFinite(style.guidance)||style.guidance<0||style.guidance>10)) errors.push('Steps는 1~50, Guidance는 0~10으로 설정해 주세요.');
  if(s.reference.enabled) {
    if(!s.reference.items.length) errors.push('Reference 이미지를 추가해 주세요.');
    if(MODELS.some(([id])=>id===m)&&!m.includes('4-5')&&!m.includes('diffusion-5')) errors.push('Precise Reference는 V4.5 모델에서 지원합니다. 이전 모델은 Vibe Transfer를 사용해 주세요.');
    if(s.vibe.enabled) errors.push('Reference와 Vibe Transfer 중 한 가지를 활성화해 주세요.');
  }
  if(s.vibe.enabled) {
    if(!s.vibe.items.length) errors.push('Vibe Transfer 이미지를 추가해 주세요.');
    if(s.vibe.items.length>16) errors.push('Vibe Transfer는 최대 16장입니다.');
    if(m==='nai-diffusion-2') errors.push('Vibe Transfer는 V3 이상 모델을 사용해 주세요.');
  }
  for(const [key,label] of [['reference','Reference'],['vibe','Vibe Transfer']]) if(s[key].enabled) {
    if(s[key].items.length>16) errors.push(`${label} 이미지는 최대 16장입니다.`);
    for(const item of s[key].items) {
      const values=key==='reference'?[item.strength,item.fidelity]:[item.strength,item.information];
      if(!values.every(n=>Number.isFinite(n)&&n>=0&&n<=1))errors.push(`${label} 수치는 0~1 사이로 입력해 주세요.`);
      if(key==='reference'&&!['character','style','character_and_style'].includes(item.type))errors.push('Reference 종류를 선택해 주세요.');
    }
  }
  if(s.img2img.enabled&&!s.img2img.image) errors.push('img2img 원본 이미지를 추가해 주세요.');
  if(s.img2img.enabled&&![s.img2img.strength,s.img2img.noise].every(n=>Number.isFinite(n)&&n>=0&&n<=1))errors.push('img2img 강도와 Noise는 0~1 사이로 입력해 주세요.');
  return errors;
}
export function buildRequest(s,e,seed,prepared={}) {
  const p=prompts(s,e),m=modelOf(s),g=s.generation,st=s.styles.find(x=>x.id===s.selectedStyle);
  const refs=s.reference.enabled?s.reference.items:[],vibes=s.vibe.enabled?s.vibe.items:[];
  if(s.api.provider==='shared') {
    const body={model:m==='nai-diffusion-4-curated-preview'?'nai-diffusion-4-curated':m,prompt:modern(m)?p.base:p.full,negative_prompt:modern(m)?p.baseUC:p.uc,width:g.width,height:g.height,steps:st.steps,scale:st.guidance,sampler:g.sampler,schedule:g.schedule,seed,cfg_rescale:0,sm:false,variety:false,legacy_uc:false,uc_preset:3,quality_toggle:false,n_samples:1,model_mode:'anime',
      characters:modern(m)?p.cast.map(c=>({enabled:true,positive_prompt:c.prompt,negative_prompt:c.uc,center_x:c.x,center_y:c.y,use_custom_position:!!s.multi?.useCoords})):[],
      precise_references:refs.map(r=>({image_base64:r.data,reference_type:r.type,strength:r.strength,fidelity:r.fidelity,file_name:r.name})),
      vibe_transfers:vibes.map(r=>({image_base64:r.data,strength:r.strength,information_extracted:r.information,is_encoded:false,file_name:r.name}))};
    if(s.img2img.enabled) Object.assign(body,{image_base64:prepared.img2img||s.img2img.image.data,image_fit:s.img2img.fit,denoise_strength:s.img2img.strength,denoise_noise:s.img2img.noise});
    return {path:s.img2img.enabled?'/generate/img2img':'/generate/txt2img',body};
  }
  const condition=(base,char,include=!!char)=>({caption:{base_caption:base,char_captions:include?[{char_caption:char,centers:[{x:0.5,y:0.5}]}]:[]},use_coords:false,use_order:true});
  const parameters={params_version:3,width:g.width,height:g.height,scale:st.guidance,sampler:g.sampler,steps:st.steps,seed,n_samples:1,ucPreset:3,qualityToggle:false,negative_prompt:modern(m)?p.baseUC:p.uc,sm:false,sm_dyn:false,dynamic_thresholding:false,cfg_rescale:0,noise_schedule:g.schedule,legacy:false,legacy_v3_extend:false,deliberate_euler_ancestral_bug:false,prefer_brownian:true};
  if(modern(m)) Object.assign(parameters,{v4_prompt:{caption:{base_caption:p.base,char_captions:p.cast.map(c=>({char_caption:c.prompt,centers:[{x:c.x,y:c.y}]}))},use_coords:!!s.multi?.useCoords,use_order:true},v4_negative_prompt:{caption:{base_caption:p.baseUC,char_captions:p.cast.map(c=>({char_caption:c.uc,centers:[{x:c.x,y:c.y}]}))},use_coords:!!s.multi?.useCoords,use_order:true,legacy_uc:false}});
  if(refs.length) Object.assign(parameters,{director_reference_images:prepared.references||refs.map(r=>r.data),director_reference_descriptions:refs.map(r=>condition(r.type==='character_and_style'?'character&style':r.type,'')),director_reference_information_extracted:refs.map(()=>1),director_reference_strength_values:refs.map(r=>r.strength),director_reference_secondary_strength_values:refs.map(r=>1-r.fidelity)});
  if(vibes.length) Object.assign(parameters,{reference_image_multiple:prepared.vibes||vibes.map(r=>r.data),reference_information_extracted_multiple:vibes.map(r=>r.information),reference_strength_multiple:vibes.map(r=>r.strength)});
  if(s.img2img.enabled) Object.assign(parameters,{image:prepared.img2img||s.img2img.image.data,strength:s.img2img.strength,noise:s.img2img.noise,extra_noise_seed:seed});
  return {path:'/ai/generate-image',body:{input:modern(m)?p.base:p.full,model:m,action:s.img2img.enabled?'img2img':'generate',parameters}};
}
export function safeName(s) {return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\.+/g,'.').replace(/^\.|\.$/g,'').slice(0,80)||'asset';}
export function parseBackup(raw) {
  if(!raw||raw.format!=='asset-studio-backup'||raw.version!==1||!raw.settings) throw Error('Asset Studio v1 백업 파일을 선택해 주세요.');
  const s=migrateSettings(raw.settings);
  for(const key of ['styles','characters','expressions']) {
    if(!Array.isArray(s[key])||!s[key].length||s[key].length>2000) throw Error('백업의 프리셋 목록이 올바르지 않습니다.');
    const ids=new Set();
    for(const x of s[key]) {if(!x||typeof x.id!=='string'||ids.has(x.id)||!['name','prompt','uc'].every(k=>typeof x[k]==='string')||!x.name.trim()) throw Error('백업 프리셋 형식이 올바르지 않습니다.');ids.add(x.id);}
  }
  if(!s.api?.profiles?.novelai||!s.api?.profiles?.shared||!s.generation||!s.reference||!s.vibe||!s.img2img||!Array.isArray(s.selectedExpressions)) throw Error('백업 설정이 누락되었습니다.');
  for(const p of Object.values(s.api.profiles)) if(typeof p.token!=='string'||typeof p.base!=='string') throw Error('백업 API 설정이 올바르지 않습니다.');
  for(const k of ['reference','vibe']) {
    if(!Array.isArray(s[k].items)||s[k].items.length>16) throw Error('백업 이미지 목록이 올바르지 않습니다.');
    for(const x of s[k].items) if(!x||typeof x.id!=='string'||typeof x.data!=='string'||typeof x.name!=='string'||typeof x.mime!=='string'||![x.strength,k==='vibe'?x.information:x.fidelity].every(n=>typeof n==='number'&&n>=0&&n<=1)) throw Error('백업 이미지 설정이 올바르지 않습니다.');
  }
  if(s.img2img.image && (typeof s.img2img.image.data!=='string'||typeof s.img2img.image.mime!=='string')) throw Error('백업 원본 이미지가 올바르지 않습니다.');
  if(!Array.isArray(s.selectedCharacters)||typeof s.assignments!=='object'||!s.assignments||typeof s.multi?.scene!=='string')throw Error('캐릭터 배치 설정이 올바르지 않습니다.');
  // Backups may contain an unfinished scene; validate configuration types without requiring a runnable batch.
  const errors=validate({...s,selectedCharacters:[s.characters[0].id],selectedExpressions:s.selectedExpressions.length?s.selectedExpressions:[s.expressions[0].id],reference:{...s.reference,enabled:false},vibe:{...s.vibe,enabled:false},img2img:{...s.img2img,enabled:false}},false);
  if(errors.length) throw Error(errors.join('\n'));
  return structuredClone(s);
}
