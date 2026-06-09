// audio.js — Generative ambient audio engine

window.AudioEngine = (function(){
  let ctx=null, enabled=false;
  let droneOsc=null, droneGain=null, filterNode=null, reverbGain=null;
  let pingOsc=null, pingGain=null;
  let masterGain=null;
  let animFrame=null;

  // Current state fed from outside
  let state = { altitude:408, distKm:5000, overhead:false, satCount:1 };

  function init(){
    if(ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain(); masterGain.gain.value=0.0; masterGain.connect(ctx.destination);

    // --- DRONE --- low ambient hum
    droneOsc = ctx.createOscillator();
    droneOsc.type='sine';
    droneOsc.frequency.value=55; // deep A1

    const droneOsc2 = ctx.createOscillator();
    droneOsc2.type='sine';
    droneOsc2.frequency.value=82.4; // E2 fifth

    droneGain = ctx.createGain(); droneGain.gain.value=0.3;
    const droneGain2 = ctx.createGain(); droneGain2.gain.value=0.15;

    filterNode = ctx.createBiquadFilter();
    filterNode.type='lowpass'; filterNode.frequency.value=400; filterNode.Q.value=1.2;

    // Reverb via convolver (fake with delay chain)
    const delay = ctx.createDelay(4.0); delay.delayTime.value=1.8;
    const delayGain = ctx.createGain(); delayGain.gain.value=0.25;
    reverbGain = ctx.createGain(); reverbGain.gain.value=0.4;

    droneOsc.connect(droneGain); droneGain.connect(filterNode);
    droneOsc2.connect(droneGain2); droneGain2.connect(filterNode);
    filterNode.connect(masterGain);
    filterNode.connect(delay); delay.connect(delayGain); delayGain.connect(delay);
    delayGain.connect(reverbGain); reverbGain.connect(masterGain);

    // --- PING --- for overhead pass
    pingGain = ctx.createGain(); pingGain.gain.value=0; pingGain.connect(masterGain);

    droneOsc.start(); droneOsc2.start();
    startModulation();
  }

  function startModulation(){
    let t=0;
    function mod(){
      if(!ctx||!enabled){ animFrame=requestAnimationFrame(mod); return; }
      t += 0.002;
      // Drone pitch shifts with altitude (lower orbit = slightly higher freq)
      const altFactor = Math.max(0.8, Math.min(1.2, 1-(state.altitude-400)/2000));
      droneOsc&&(droneOsc.frequency.value = 55 * altFactor * (1+0.01*Math.sin(t*0.3)));

      // Filter opens as ISS approaches
      const distFactor = Math.max(0, 1 - state.distKm/8000);
      filterNode&&(filterNode.frequency.value = 200 + distFactor*600 + 50*Math.sin(t*0.15));

      // Subtle tremolo
      droneGain&&(droneGain.gain.value = 0.25 + 0.08*Math.sin(t*0.7));

      // Overhead ping — rhythmic pulse when within 500km
      if(state.overhead && pingGain){
        const pingRate = Math.max(0.5, 2-state.distKm/500);
        pingGain.gain.value = 0.15*Math.max(0,Math.sin(t*pingRate*Math.PI));
      } else {
        pingGain&&(pingGain.gain.value = Math.max(0, pingGain.gain.value*0.95));
      }
      animFrame=requestAnimationFrame(mod);
    }
    animFrame=requestAnimationFrame(mod);
  }

  function enable(){
    if(!ctx) init();
    enabled=true;
    ctx.resume();
    masterGain&&masterGain.gain.setTargetAtTime(0.6, ctx.currentTime, 1.5);
  }

  function disable(){
    enabled=false;
    masterGain&&masterGain.gain.setTargetAtTime(0, ctx.currentTime, 1.0);
  }

  function updateState(s){ Object.assign(state, s); }

  function pingAlert(){
    // One-shot chime for pass alert
    if(!ctx||!enabled) return;
    const o=ctx.createOscillator(); const g=ctx.createGain();
    o.type='sine'; o.frequency.value=880;
    g.gain.value=0.4;
    o.connect(g); g.connect(masterGain);
    o.start(); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime+2);
    setTimeout(()=>{ try{o.stop();}catch(e){} },2100);
    // Second harmonic
    setTimeout(()=>{
      if(!ctx||!enabled) return;
      const o2=ctx.createOscillator(); const g2=ctx.createGain();
      o2.type='sine'; o2.frequency.value=1320; g2.gain.value=0.2;
      o2.connect(g2); g2.connect(masterGain);
      o2.start(); g2.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+1.5);
      setTimeout(()=>{ try{o2.stop();}catch(e){} },1600);
    },300);
  }

  function isEnabled(){ return enabled; }
  return { enable, disable, updateState, pingAlert, isEnabled };
})();
