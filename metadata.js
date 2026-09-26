import {MODELS,uid} from './core.js';
const utf8=new TextDecoder('utf-8'),latin=new TextDecoder('latin1'),LIMIT=4*1024*1024;
const parseJSON=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return null;}};
async function decompress(bytes,format){
  if(bytes.length>LIMIT)throw Error('메타데이터 용량이 너무 큽니다.');
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)),reader=stream.getReader(),chunks=[];let length=0;
  try {while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>LIMIT)throw Error('메타데이터 용량이 너무 큽니다.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  const out=new Uint8Array(length);let offset=0;for(const chunk of chunks){out.set(chunk,offset);offset+=chunk.length;}return out;
}
export async function pngText(bytes){
  const result={};if(bytes.length<24||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return result;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let offset=8;offset+12<=bytes.length;){
    const size=view.getUint32(offset),type=utf8.decode(bytes.subarray(offset+4,offset+8));
    if(size>bytes.length-offset-12)throw Error('PNG 파일의 메타데이터 구조가 손상되었습니다.');
    if(['tEXt','zTXt','iTXt'].includes(type)&&size<=LIMIT){
      const data=bytes.subarray(offset+8,offset+8+size),zero=data.indexOf(0);
      if(zero>0&&zero<80){const key=latin.decode(data.subarray(0,zero));
        if(type==='tEXt')result[key]=utf8.decode(data.subarray(zero+1));
        if(type==='zTXt'&&data[zero+1]===0)result[key]=utf8.decode(await decompress(data.subarray(zero+2),'deflate'));
        if(type==='iTXt'){
          const flag=data[zero+1],method=data[zero+2],languageEnd=data.indexOf(0,zero+3),translatedEnd=languageEnd>=0?data.indexOf(0,languageEnd+1):-1;
          if(translatedEnd>=0&&method===0&&[0,1].includes(flag)){const text=data.subarray(translatedEnd+1);result[key]=utf8.decode(flag?await decompress(text,'deflate'):text);}
        }
      }
    }
    offset+=size+12;if(type==='IEND')break;
  }
  return result;
}
export async function stealthText(rgba,width,height){
  // NovelAI PNGs can store gzip JSON in least-significant alpha bits, column first.
  // Also accept row-first and legacy RGB layouts without allocating a bit array.
  for(const channel of ['alpha','rgb'])for(const order of ['column','row']){
    let cursor=0;const channels=channel==='alpha'?1:3,capacity=width*height*channels;
    const nextByte=()=>{if(cursor+8>capacity)throw Error('end');let n=0;for(let b=0;b<8;b++,cursor++){const pixel=Math.floor(cursor/channels),x=order==='column'?Math.floor(pixel/height):pixel%width,y=order==='column'?pixel%height:Math.floor(pixel/width),component=channel==='alpha'?3:cursor%3;n=(n<<1)|(rgba[(y*width+x)*4+component]&1);}return n;};
    try {
      let signature='';for(let i=0;i<15;i++)signature+=String.fromCharCode(nextByte());
      if(!['stealth_pngcomp','stealth_pnginfo','stealth_rgbcomp','stealth_rgbinfo'].includes(signature))continue;
      let bits=0;for(let i=0;i<4;i++)bits=bits*256+nextByte();
      if(bits%8||bits<=0||bits>LIMIT*8||bits>capacity-cursor)continue;
      const payload=new Uint8Array(bits/8);for(let i=0;i<payload.length;i++)payload[i]=nextByte();
      return utf8.decode(signature.endsWith('comp')?await decompress(payload,'gzip'):payload);
    }catch{/* Missing or malformed stealth data is not a prompt. */}
  }
  return null;
}
function sourceModel(source){
  if(typeof source!=='string')return null;
  const direct=source.match(/nai-diffusion-[a-z0-9-]+/i);if(direct)return direct[0];
  const hashes={
    'nai-diffusion-5-full':['657484A5','0ADF9AB7','DB276663'],
    'nai-diffusion-4-5-full':['4BDE2A90','1229B44F','B9F340FD','F3D95188'],
    'nai-diffusion-4-5-curated':['C02D4F98','5AB81C7C','B5A2A797'],
    'nai-diffusion-4-full':['37442FCA','4F49EC75','CA4B7203','79F47848','F6302A9D'],
    'nai-diffusion-4-curated-preview':['7ABFFA2A','C1CCBA86','770A9E12'],
    'nai-diffusion-3':['B0BDF6C1','C1E1DE52','7BCCAA2C','1120E6A9','8BA2AF87'],
    'nai-diffusion-furry-3':['4BE8C60C','C8704949','37C2B166','F306816B','9CC2F394'],
  };
  for(const [model,list] of Object.entries(hashes))if(list.some(x=>source.toUpperCase().includes(x)))return model;
  const version=source.match(/V(5|4\.5|4|3|2)\s+(Full|Curated)/i);if(version)return `nai-diffusion-${version[1].replace('.','-')}-${version[2].toLowerCase()}`;
  return null;
}
export function normalizeMetadata(text){
  let comment=parseJSON(text.Comment)||{};
  if(comment.Comment) return normalizeMetadata({...text,...comment});
  const n=comment.parameters&&typeof comment.parameters==='object'?{...comment,...comment.parameters}:comment;
  const vp=n.v4_prompt?.caption,np=n.v4_negative_prompt?.caption;
  const prompt=vp?.base_caption??n.prompt??n.input??text.Description;
  if(typeof prompt!=='string')return null;
  const uc=np?.base_caption??n.uc??n.negative_prompt??'';
  const characters=Array.isArray(vp?.char_captions)?vp.char_captions.filter(c=>c&&typeof c.char_caption==='string').map((c,i)=>({prompt:c.char_caption,uc:np?.char_captions?.[i]?.char_caption||'',x:Number(c.centers?.[0]?.x??0.5),y:Number(c.centers?.[0]?.y??0.5)})):Array.isArray(n.characters)?n.characters.map(c=>({prompt:c.positive_prompt||c.prompt||'',uc:c.negative_prompt||c.uc||'',x:c.center_x??0.5,y:c.center_y??0.5})):[];
  const settings={};for(const [out,input] of [['steps','steps'],['guidance','scale'],['width','width'],['height','height'],['seed','seed']])if(n[input]!==undefined&&Number.isFinite(Number(n[input])))settings[out]=Number(n[input]);
  if(typeof n.sampler==='string')settings.sampler=n.sampler;
  if(typeof (n.noise_schedule??n.schedule)==='string')settings.schedule=n.noise_schedule??n.schedule;
  const model=typeof n.model==='string'?n.model:sourceModel(text.Source||n.Source);
  return {prompt,uc:typeof uc==='string'?uc:'',characters,settings,model,source:text.Source||'',useCoords:!!n.v4_prompt?.use_coords};
}
export async function readMetadata(file){
  if(file.size>20*1024*1024)throw Error('20MB 이하 이미지를 선택해 주세요.');
  const text=await pngText(new Uint8Array(await file.arrayBuffer()));let parsed=normalizeMetadata(text);
  if(!parsed){
    const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>40000000){bitmap.close();throw Error('이미지 해상도가 너무 큽니다.');}
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(bitmap,0,0);bitmap.close();
    const stealth=await stealthText(context.getImageData(0,0,canvas.width,canvas.height).data,canvas.width,canvas.height);
    if(stealth){const embedded=parseJSON(stealth);if(embedded)parsed=normalizeMetadata(embedded.Comment||embedded.Description?embedded:{Comment:stealth});}
  }
  if(!parsed)throw Error('저장된 프롬프트 메타데이터가 없습니다. NovelAI에서 다운로드한 원본 PNG를 사용해 주세요. 스크린샷이나 재저장한 이미지에는 정보가 없을 수 있습니다.');
  return parsed;
}
export function applyMetadata(current,data,fileName){
  const s=structuredClone(current),name=fileName.replace(/\.[^.]+$/,'').slice(0,50),st={id:uid(),name:`${name} · 메타데이터`,prompt:data.prompt,uc:data.uc,steps:28,guidance:5};
  const p=data.settings;
  if(Number.isInteger(p.steps)&&p.steps>=1&&p.steps<=50)st.steps=p.steps;
  if(p.guidance>=0&&p.guidance<=10)st.guidance=p.guidance;
  s.styles.push(st);s.selectedStyle=st.id;
  const chars=(data.characters.length?data.characters:[{prompt:'',uc:'',x:0.5,y:0.5}]).map((c,i)=>({id:uid(),name:`${name} · 캐릭터 ${i+1}`,prompt:c.prompt,uc:c.uc}));
  s.characters.push(...chars);s.selectedCharacters=chars.map(c=>c.id);s.selectedCharacter=chars[0].id;s.multi={scene:'',useCoords:data.useCoords};
  chars.forEach((c,i)=>{const source=data.characters[i];s.assignments[c.id]={mode:'none',expressionId:'',prompt:'',uc:'',x:source?.x??0.5,y:source?.y??0.5};});
  let original=s.expressions.find(e=>e.id==='metadata-original');if(!original){original={id:'metadata-original',name:'원본 유지',prompt:'',uc:'',group:'메타데이터'};s.expressions.push(original);}s.selectedExpressions=[original.id];
  if([p.width,p.height].every(n=>Number.isInteger(n)&&n>=64&&n<=2048&&n%64===0)&&p.width*p.height<=3145728){s.generation.width=p.width;s.generation.height=p.height;}
  if(Number.isInteger(p.seed)&&p.seed>=0&&p.seed<=4294967295)s.generation.seed=String(p.seed);
  if(p.sampler)s.generation.sampler=p.sampler;if(p.schedule)s.generation.schedule=p.schedule;
  if(data.model){if(MODELS.some(([id])=>id===data.model))s.generation.model=data.model;else{s.generation.model='custom';s.generation.customModel=data.model;}}
  // Importing prompts must not silently reuse unrelated input images from a prior scene.
  s.reference.enabled=false;s.vibe.enabled=false;s.img2img.enabled=false;
  return s;
}
