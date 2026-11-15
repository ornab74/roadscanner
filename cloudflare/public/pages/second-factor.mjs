import {api} from './common.mjs';
import {startAuthentication} from '/vendor/webauthn.mjs';
export async function completeSecondFactor(){
 if(!window.PublicKeyCredential)throw new Error('Use a browser that supports your enrolled security key or passkey.');
 const challenge=await api('/auth/passkey/options',{method:'POST',body:'{}'});
 const response=await startAuthentication({optionsJSON:challenge.options});
 return api('/auth/passkey/verify',{method:'POST',body:JSON.stringify({challenge_id:challenge.challenge_id,response})});
}
