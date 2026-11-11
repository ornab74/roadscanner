import './navigation.mjs';
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  let frames = [], timer = null;
  function render() {
    const lat = Number(el('lat').value), lon = Number(el('lon').value), z = Number(el('zoom').value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -85 || lat > 85 || lon < -180 || lon > 180 || !Number.isInteger(z) || z < 0 || z > 7) { el('status').textContent = 'Enter valid coordinates and a zoom from 0 to 7.'; return; }
    const frame = frames[Number(el('frame').value)];
    if (!frame) return;
    const n = 2 ** z, x = Math.min(n - 1, Math.floor((lon + 180) / 360 * n));
    const y = Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)));
    el('radar').src = `https://tilecache.rainviewer.com${frame.path}/512/${z}/${x}/${y}/2/1_1.png`;
    el('time').textContent = new Date(frame.time * 1000).toLocaleString();
    el('status').textContent = 'Historical radar frame. Coverage may be incomplete.';
  }
  el('radar').onerror = () => { el('status').textContent = 'Radar tile unavailable. Try another location or zoom.'; };
  el('update').onclick = render;
  el('frame').oninput = render;
  el('play').onclick = () => { if (timer) { clearInterval(timer); timer = null; el('play').textContent = 'Play'; } else if (frames.length) { timer = setInterval(() => { el('frame').value = (Number(el('frame').value) + 1) % frames.length; render(); }, 800); el('play').textContent = 'Pause'; } };
  fetch('https://api.rainviewer.com/public/weather-maps.json', {credentials:'omit'}).then(r => { if (!r.ok) throw Error('feed'); return r.json(); }).then(data => {
    frames = (Array.isArray(data?.radar?.past) ? data.radar.past : []).filter(f => Number.isSafeInteger(f.time) && /^\/v2\/radar\/[a-zA-Z0-9]+$/.test(f.path)).slice(-24);
    if (!frames.length) throw Error('empty');
    el('frame').max = frames.length - 1; el('frame').value = frames.length - 1; render();
  }).catch(() => { el('status').textContent = 'Radar feed is unavailable. Please try again later.'; });
})();
