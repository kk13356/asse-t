let promise;
function open() {
  return promise ||= new Promise((resolve,reject)=>{
    const request=indexedDB.open('asset-studio',1);
    request.onupgradeneeded=()=>{for(const name of ['settings','results','cache']) request.result.createObjectStore(name,{keyPath:'id'});};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
export async function db(store,method,value) {
  const database=await open();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(store,method==='get'||method==='getAll'?'readonly':'readwrite');
    const req=tx.objectStore(store)[method](value);
    tx.oncomplete=()=>resolve(req.result);
    tx.onerror=()=>reject(tx.error||req.error);
    tx.onabort=()=>reject(tx.error||Error('브라우저 저장소에 저장하지 못했습니다.'));
  });
}
export async function saveSettings(settings){return db('settings','put',{id:'main',value:structuredClone(settings)});}
