// NAZA-inspired two-qubit circuit, implemented analytically (no quantum hardware).
// Reference: ornab74/NAZA @ 65914e1a5f950f8a6b43811bfd54c792ce8c4cd1, GPL-3.0.
const clamp=x=>Math.max(0,Math.min(1,x));
function gate(s,bit,u){for(let i=0;i<4;i++)if(!(i&bit)){const j=i|bit,ar=s[2*i],ai=s[2*i+1],br=s[2*j],bi=s[2*j+1];s[2*i]=u[0]*ar-u[1]*ai+u[2]*br-u[3]*bi;s[2*i+1]=u[0]*ai+u[1]*ar+u[2]*bi+u[3]*br;s[2*j]=u[4]*ar-u[5]*ai+u[6]*br-u[7]*bi;s[2*j+1]=u[4]*ai+u[5]*ar+u[6]*bi+u[7]*br;}}
const rx=(s,b,t)=>{const c=Math.cos(t/2),v=Math.sin(t/2);gate(s,b,[c,0,0,-v,0,-v,c,0]);};
const ry=(s,b,t)=>{const c=Math.cos(t/2),v=Math.sin(t/2);gate(s,b,[c,0,-v,0,v,0,c,0]);};
const rz=(s,b,t)=>{const c=Math.cos(t/2),v=Math.sin(t/2);gate(s,b,[c,-v,0,0,0,0,c,v]);};
export function nazaState(rgb,{seed=1,shots=256}={}){
 if(!Array.isArray(rgb)||rgb.length!==3||rgb.some(x=>!Number.isFinite(x)))throw Error('Invalid state inputs');
 if(!Number.isInteger(shots)||shots<1||shots>4096)throw Error('Invalid simulated shot count');
 const [x,y,z]=rgb.map(clamp),s=new Float64Array(8);s[0]=1;
 rx(s,2,x*Math.PI);ry(s,1,y*Math.PI);[s[4],s[6]]=[s[6],s[4]];[s[5],s[7]]=[s[7],s[5]];
 rz(s,1,z*Math.PI);rx(s,2,(x+y)*Math.PI/2);ry(s,1,(y+z)*Math.PI/2);
 const populations=Array.from({length:4},(_,i)=>s[2*i]**2+s[2*i+1]**2),norm=populations.reduce((a,b)=>a+b,0);
 if(Math.abs(norm-1)>1e-9)throw Error('State normalization failed');
 const ev0=populations[0]+populations[1]-populations[2]-populations[3],ev1=populations[0]-populations[1]+populations[2]-populations[3];
 const a=populations[0]+populations[1],d=1-a,cr=s[0]*s[4]+s[1]*s[5]+s[2]*s[6]+s[3]*s[7],ci=s[1]*s[4]-s[0]*s[5]+s[3]*s[6]-s[2]*s[7],det=Math.max(0,a*d-cr*cr-ci*ci),lambda=clamp(.5+Math.sqrt(Math.max(0,.25-det)));
 const entropy=[lambda,1-lambda].reduce((h,p)=>p>0?h-p*Math.log2(p):h,0),purity=clamp(a*a+d*d+2*(cr*cr+ci*ci)),score=1/(1+Math.exp(-6*(.6*(ev0+1)/2+.4*(ev1+1)/2-.5)));
 let rng=seed>>>0||1;const random=()=>{rng^=rng<<13;rng^=rng>>>17;rng^=rng<<5;return (rng>>>0)/4294967296;},counts=[0,0,0,0];
 for(let n=0;n<shots;n++){const r=random();let sum=0;for(let i=0;i<4;i++){sum+=populations[i];if(r<sum||i===3){counts[i]++;break;}}}
 return {provenance:'SIMULATED',version:'naza-rx-ry-cnot-rz-rx-ry-v1',inputs:[x,y,z],seed:seed>>>0,shots,state:Array.from(s),populations,analytic:{ev0,ev1,entropic_score:score,entanglement_bits:entropy,reduced_purity:purity},sampled:{counts,ev0:(counts[0]+counts[1]-counts[2]-counts[3])/shots,ev1:(counts[0]-counts[1]+counts[2]-counts[3])/shots}};
}
export function seedFor(text){let h=2166136261;for(const c of String(text)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
export async function stateReceipt(state){const value=JSON.stringify({version:state.version,inputs:state.inputs,seed:state.seed,shots:state.shots,analytic:state.analytic});const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');}
