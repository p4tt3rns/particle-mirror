import('tone').then(Tone => {
  try {
    const p = new Tone.Panner(0);
    console.log('pannerX pan:', typeof p.pan, typeof p.pan.rampTo);
  } catch(e) { console.error('Panner error', e); }
  
  try {
    const v = new Tone.Volume(0);
    console.log('volume volume:', typeof v.volume, typeof v.volume.rampTo);
  } catch(e) { console.error('Volume error', e); }
  
  try {
    const o = new Tone.Oscillator(0);
    console.log('osc freq:', typeof o.frequency, typeof o.frequency.rampTo);
  } catch(e) { console.error('Osc error', e); }
});
