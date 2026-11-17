"""Synthesize an original ambient/electronic score. No samples or licensed tracks."""
import numpy as np, wave, pathlib, sys
out=pathlib.Path(sys.argv[1]);out.parent.mkdir(parents=True,exist_ok=True)
sr=48000;duration=65;t=np.arange(sr*duration)/sr;mix=np.zeros_like(t);rng=np.random.default_rng(7412)
chords=[[57,60,64,67],[60,64,67,71],[55,59,62,64],[62,64,69,74]]
def hz(m):return 440*2**((m-69)/12)
for start in np.arange(0,duration,5):
 idx=(t>=start)&(t<min(start+6,duration));u=t[idx]-start;env=np.minimum(1,u/.7)*np.minimum(1,np.maximum(0,(6-u)/1.2))
 for note in chords[int(start/5)%4]:
  f=hz(note);mix[idx]+=.025*env*(np.sin(2*np.pi*f*u)+.2*np.sin(4*np.pi*f*u))*np.sin(np.pi*np.minimum(1,u/5))
beat=60/96
for i,start in enumerate(np.arange(0,duration,beat)):
 idx=(t>=start)&(t<start+.5);u=t[idx]-start
 mix[idx]+=.10*np.exp(-u*11)*np.sin(2*np.pi*(48*u+35*(1-np.exp(-u*18))/18))
 note=[45,48,43,50][int(start/5)%4];mix[idx]+=.04*np.exp(-u*7)*np.sin(2*np.pi*hz(note)*u)
for start in np.arange(0,duration,beat/2):
 idx=(t>=start)&(t<start+.09);u=t[idx]-start;n=rng.normal(0,1,u.size);mix[idx]+=.012*np.exp(-u*65)*(n-np.roll(n,1))
for start in [4.6,15.6,26.6,37.6,47.6,55.6]:
 idx=(t>=start)&(t<start+.6);u=t[idx]-start;n=rng.normal(0,1,u.size);smooth=np.convolve(n,np.ones(15)/15,'same');mix[idx]+=.045*np.sin(np.pi*u/.6)**2*smooth
melody=[81,76,79,74,76,71,72,76]
for i,start in enumerate(np.arange(2,duration,1.25)):
 idx=(t>=start)&(t<start+1.6);u=t[idx]-start;f=hz(melody[i%len(melody)]);mix[idx]+=.016*np.exp(-u*3)*(np.sin(2*np.pi*f*u)+.25*np.sin(2*np.pi*f*2.003*u))
fade=np.minimum(1,t/1.4)*np.minimum(1,np.maximum(0,(duration-t)/2.5));mix=np.tanh(mix*1.5)*fade
left=mix;right=.94*mix+.06*np.roll(mix,int(.019*sr));stereo=np.column_stack([left,right]);stereo=np.clip(stereo,-.9,.9)
with wave.open(str(out),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((stereo*32767).astype('<i2').tobytes())
print(out)
