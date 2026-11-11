export function imageDimensions(data){
 const b=i=>typeof data==='string'?data.charCodeAt(i):data[i],u16=i=>b(i)*256+b(i+1),u32=i=>b(i)*16777216+b(i+1)*65536+b(i+2)*256+b(i+3);
 if(data.length>=33&&[137,80,78,71,13,10,26,10].every((v,i)=>b(i)===v)){
  if(u32(8)!==13||![73,72,68,82].every((v,i)=>b(i+12)===v))throw Error('Invalid PNG header');
  return {format:'png',width:u32(16),height:u32(20)};
 }
 if(data.length>=12&&b(0)===255&&b(1)===216){
  let p=2;while(p+9<Math.min(data.length,131072)){
   if(b(p)!==255)throw Error('Invalid JPEG header');while(b(p)===255)p++;const marker=b(p++);
   if(marker===217||marker===218)break;if(marker===1||marker>=208&&marker<=215)continue;
   const length=u16(p);if(length<2||p+length>data.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {format:'jpeg',width:u16(p+5),height:u16(p+3)};
   p+=length;
  }
 }
 throw Error('Invalid image header');
}
export function constrainImage(data,{format,width,height,maxSide=1400,maxPixels=1960000}={}){
 const size=imageDimensions(data);if(format&&size.format!==format)throw Error('Image media type mismatch');
 if(!Number.isInteger(size.width)||!Number.isInteger(size.height)||size.width<1||size.height<1||size.width>maxSide||size.height>maxSide||size.width*size.height>maxPixels)throw Error('Image dimensions exceed limits');
 if(width!==undefined&&(size.width!==width||size.height!==height))throw Error('Image dimensions do not match capture');return size;
}
