import {modelOf,modern,buildRequest} from './core.js';
import {db} from './db.js';
export const base64 = bytes => {let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);};
export function from64(s) {const raw=atob(s.replace(/^data:[^,]+,/,'')),out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out;}
export async function request(profile,path,body,signal,method='POST') {
  let url;try{url=new URL(profile.base.trim().replace(/\/+$/,'')+path);}catch{throw Error('API 주소 형식이 올바르지 않습니다. https://image.novelai.net 형태로 입력해 주세요.');}
  if(!['https:','http:'].includes(url.protocol))throw Error('API 주소는 https:// 또는 http://로 시작해야 합니다.');
  const token=profile.token?.replace(/^Bearer\s+/i,'').trim()||'';
  if(token&&/[^\x21-\x7e]/.test(token))throw Error('토큰에 공백 또는 잘못된 문자가 있습니다. Persistent API Token 전체를 다시 복사해 주세요.');
  if(globalThis.location?.protocol==='https:'&&url.protocol==='http:')throw Error('HTTPS 사이트에서는 HTTP API에 연결할 수 없습니다. API 주소를 HTTPS로 설정해 주세요.');
  const timeout=AbortSignal.timeout(300000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  let response;
  try {response=await fetch(url.href,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{'Authorization':`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:combined,credentials:'omit',redirect:'error'});}
  catch(error) {if(signal?.aborted) throw signal.reason; if(timeout.aborted)throw Error('응답 시간이 5분을 초과했습니다. 서버에서 이미 생성했을 수 있으니 확인 후 다시 시도해 주세요.');if(globalThis.navigator?.onLine===false)throw Error('인터넷 연결이 끊겨 있습니다. 네트워크 연결 후 다시 시도해 주세요.');const target=url.hostname==='sharednai5.pro'?'SharedNAI':url.origin;throw Error(`API 응답을 받지 못했습니다. 요청 대상: ${target}${url.pathname}\n브라우저에서는 네트워크 오류와 CORS 차단을 구분할 수 없습니다. 개발자 도구(F12)의 Console·Network 오류를 확인해 주세요. 토큰 유효성은 아직 확인되지 않았습니다.`);}
  if(!response.ok) {
    let detail=await response.text();
    try {const j=JSON.parse(detail);detail=j.detail||j.message||j.error||detail;if(typeof detail!=='string')detail=JSON.stringify(detail);} catch{}
    if(profile.base.includes('sharednai5.pro'))detail=detail.replace(/(?:https?:\/\/)?(?:www\.)?sharednai5\.pro[^\s"'<>]*/gi,'SharedNAI');
    const hints={401:'토큰이 유효하지 않거나 만료되었습니다. 다시 연결해 주세요.',402:'잔액 또는 구독을 확인해 주세요.',403:'계정 권한 또는 서비스의 이용 확인이 필요합니다.',429:'요청 제한에 도달했습니다. 생성 간격을 늘려 주세요.'};
    throw Error(`${hints[response.status]||'이미지 API 요청이 실패했습니다.'} (HTTP ${response.status})\n${detail.slice(0,800)}`);
  }
  return response;
}
export async function connect(s) {
  let p=s.api.profiles[s.api.provider];
  if(s.api.provider==='shared'&&!p.loginSession)throw Error('SharedNAI 계정으로 로그인해 주세요.');
  if(!p.token.trim()) throw Error('토큰을 입력해 주세요.');
  if(s.api.provider==='novelai') {
    await request(p,'/user/subscription',null,null,'GET');
  } else await request(p,'/account',null,null,'GET');
}
export async function login(profile,username,password) {
  const res=await request({...profile,token:''},'/auth/login',{username,password});
  const result=await res.json();
  if(!result.access_token) throw Error('로그인 응답에 토큰이 없습니다.');
  return result.access_token;
}
export async function readImage(file) {
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)) throw Error('PNG, JPEG, WebP 이미지를 선택해 주세요.');
  if(file.size>20*1024*1024) throw Error('이미지는 한 장당 20MB 이하로 선택해 주세요.');
  const bitmap=await createImageBitmap(file);const width=bitmap.width,height=bitmap.height;bitmap.close();
  if(width*height>40000000) throw Error('4천만 픽셀 이하 이미지를 사용해 주세요.');
  return {id:crypto.randomUUID(),name:file.name,mime:file.type,data:base64(new Uint8Array(await file.arrayBuffer())),width,height,strength:0.6,information:1,fidelity:0,type:'character_and_style'};
}
export async function fitImage(image,width,height,fit='contain',black=true) {
  const bitmap=await createImageBitmap(new Blob([from64(image.data)],{type:image.mime}));
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');ctx.fillStyle=black?'#000':'#fff';ctx.fillRect(0,0,width,height);
  const scale=fit==='cover'?Math.max(width/bitmap.width,height/bitmap.height):Math.min(width/bitmap.width,height/bitmap.height);
  ctx.drawImage(bitmap,(width-bitmap.width*scale)/2,(height-bitmap.height*scale)/2,bitmap.width*scale,bitmap.height*scale);bitmap.close();
  return canvas.toDataURL('image/png').split(',')[1];
}
export async function prepare(s,signal,onStatus=()=>{}) {
  const prepared={},m=modelOf(s),profile=s.api.profiles[s.api.provider];
  if(s.img2img.enabled) prepared.img2img=await fitImage(s.img2img.image,s.generation.width,s.generation.height,s.img2img.fit,false);
  if(s.api.provider==='shared') return prepared;
  if(s.reference.enabled) {
    prepared.references=[];
    for(const r of s.reference.items) {signal?.throwIfAborted();const ratio=r.width/r.height;const size=ratio>1.2?[1536,1024]:ratio<0.83?[1024,1536]:[1472,1472];prepared.references.push(await fitImage(r,...size));}
  }
  if(s.vibe.enabled) {
    prepared.vibes=[];
    for(let i=0;i<s.vibe.items.length;i++) {
      signal?.throwIfAborted();const v=s.vibe.items[i];
      if(!modern(m)){prepared.vibes.push(v.data);continue;}
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${profile.base}|${m}|${v.information}|${v.data}`));
      const key=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
      let cached=await db('cache','get',key);
      if(!cached) {
        onStatus(`Vibe ${i+1}/${s.vibe.items.length} 인코딩 중…`);
        const res=await request(profile,'/ai/encode-vibe',{image:v.data,model:m,information_extracted:v.information},signal);
        cached={id:key,data:base64(new Uint8Array(await res.arrayBuffer()))};await db('cache','put',cached);
      }
      prepared.vibes.push(cached.data);
    }
  }
  return prepared;
}
export async function decodeResponse(response,profile,signal) {
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes[0]===0x50&&bytes[1]===0x4b) {
    if(!globalThis.fflate) throw Error('ZIP 라이브러리를 불러오지 못했습니다. 새로고침해 주세요.');
    const entries=globalThis.fflate.unzipSync(bytes,{filter:f=>/\.(png|jpe?g|webp)$/i.test(f.name)&&f.originalSize<100*1024*1024});
    return Object.entries(entries).map(([name,data])=>({blob:new Blob([data],{type:/\.webp$/i.test(name)?'image/webp':/\.jpe?g$/i.test(name)?'image/jpeg':'image/png'})}));
  }
  if(response.headers.get('content-type')?.startsWith('image/')) return [{blob:new Blob([bytes],{type:response.headers.get('content-type')})}];
  let json;try {json=JSON.parse(new TextDecoder().decode(bytes));} catch {throw Error('API가 이미지 대신 알 수 없는 응답을 반환했습니다. API 주소를 확인해 주세요.');}
  const items=Array.isArray(json)?json:json.images;
  if(!Array.isArray(items)||!items.length) throw Error('응답에 생성된 이미지가 없습니다.');
  const results=[];
  for(const item of items) {
    const encoded=typeof item==='string'?item:item.image_base64||item.image||item.b64_json;
    if(encoded) results.push({blob:new Blob([from64(encoded)],{type:'image/png'}),seed:item.seed});
    else if(item.image_url) {
      const url=new URL(item.image_url,profile.base+'/');
      if(!['https:','http:'].includes(url.protocol)) throw Error('지원하지 않는 이미지 주소입니다.');
      const same=url.origin===new URL(profile.base).origin;
      const res=await fetch(url,{headers:same?{Authorization:`Bearer ${profile.token}`}:{},signal,credentials:'omit'});
      if(!res.ok)throw Error('생성 이미지 다운로드에 실패했습니다.');
      const blob=await res.blob();if(!blob.type.startsWith('image/'))throw Error('이미지 응답 형식이 올바르지 않습니다.');results.push({blob,seed:item.seed});
    } else throw Error('API 이미지 데이터가 누락되었습니다.');
  }
  return results;
}
export async function outputImage(blob,format='png') {
  if(!['png','webp'].includes(format))throw Error('지원하지 않는 이미지 형식입니다.');
  const mime='image/'+format;
  if(blob.type===mime)return blob;
  const bitmap=await createImageBitmap(blob);
  try {
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
    canvas.getContext('2d').drawImage(bitmap,0,0);
    const converted=await new Promise(resolve=>canvas.toBlob(resolve,mime,0.95));
    if(!converted||converted.type!==mime)throw Error('이 브라우저는 선택한 이미지 형식 저장을 지원하지 않습니다.');
    return converted;
  } finally {bitmap.close();}
}
export async function generate(s,expression,seed,prepared,signal) {
  const spec=buildRequest(s,expression,seed,prepared),profile=s.api.profiles[s.api.provider];
  const response=await request(profile,spec.path,spec.body,signal);
  const images=await decodeResponse(response,profile,signal);
  if(!images.length) throw Error('생성된 이미지가 없습니다.');
  for(const image of images) {image.blob=await outputImage(image.blob,s.generation.format??'png');const b=await createImageBitmap(image.blob);image.width=b.width;image.height=b.height;b.close();}
  return images;
}
