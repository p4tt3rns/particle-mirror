    (function () {
      const video = document.getElementById('video');
      const pixelCanvas = document.getElementById('pixel-canvas');
      const mainCanvas = document.getElementById('main-canvas');
      const pixCtx = pixelCanvas.getContext('2d', { willReadFrequently: true });
      const ctx = mainCanvas.getContext('2d');
      const permOverlay = document.getElementById('perm-overlay');
      const permBtn = document.getElementById('perm-btn');
      const errorMsg = document.getElementById('error-msg');

      const W = () => mainCanvas.width;
      const H = () => mainCanvas.height;

      let mode = 'portrait';
      let density = 0.68, scatter = 0.40, repulse = 0.55, threshold = 0.28;
      let audioMuted = false;

      const state = {
        running: false,
        handX: -1,
        handY: -1,
        handSX: 0.5,
        handSY: 0.5,
        handActive: false,
        handOpenness: 0,
        prevHandX: -1,
        prevHandY: -1,
        handVelX: 0,
        handVelY: 0,
        mouseX: -1,
        mouseY: -1,
        frame: 0,
        particles: [],
        targetParticleCount: 0,
      };

      let hands = null;


      // ---- Particle system ----
      // Dynamic MAX_P: scales with screen area. ~50k base, up to 120k for large/4K screens
      const screenArea = window.innerWidth * window.innerHeight;
      let MAX_P = Math.min(120000, Math.max(100000, Math.round(screenArea * 0.04)));
      const particles = [];

      // Recalculate on resize
      window.addEventListener('resize', () => {
        const area = window.innerWidth * window.innerHeight;
        MAX_P = Math.min(120000, Math.max(100000, Math.round(area * 0.04)));
      });

      function Particle(x, y, brightness) {
        this.ox = x; this.oy = y;
        this.x = x + (Math.random() - 0.5) * 8;
        this.y = y + (Math.random() - 0.5) * 8;
        this.vx = 0; this.vy = 0;
        this.brightness = brightness;
        this.size = 0.32 + brightness * 0.9 + Math.random() * 0.35;
        this.alpha = 0.3 + brightness * 0.7;
        this.chromatic = Math.random() < 0.03; // 3% chrome particles
        this.noiseOff = Math.random() * 1000;
        this.life = 1;
        this.touch = 0; // how recently this particle was affected by the hand
      }

      // Simple Perlin-ish noise (value noise)
      const noiseTable = new Float32Array(512);
      for (let i = 0; i < 512; i++) noiseTable[i] = Math.random() * 2 - 1;
      function noise(x, y, t) {
        const ix = Math.floor(x) & 255, iy = Math.floor(y) & 255, it = Math.floor(t) & 255;
        return noiseTable[(ix + iy * 57 + it * 131) & 511];
      }

      // ---- Webcam sampling ----
      const SAMPLE_W = 160;
      const SAMPLE_H = 120;

      function sampleFrame() {
        pixCtx.save();
        pixCtx.scale(-1, 1); // mirror
        pixCtx.drawImage(video, -SAMPLE_W, 0, SAMPLE_W, SAMPLE_H);
        pixCtx.restore();
        return pixCtx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
      }

      function rebuildParticles(imageData) {
        const data = imageData.data;
        const scaleX = W() / SAMPLE_W;
        const scaleY = H() / SAMPLE_H;
        const scatterPx = scatter * 14;
        const thresh = threshold * 200 + 20;
        const skip = Math.max(1, Math.round(2.5 - density * 1.8));

        particles.length = 0;

        for (let py = 0; py < SAMPLE_H; py += skip) {
          for (let px = 0; px < SAMPLE_W; px += skip) {
            const idx = (py * SAMPLE_W + px) * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            const lum = 0.299 * r + 0.587 * g + 0.114 * b;
            if (lum < thresh) continue;
            const brightness = lum / 255;

            // Multiple particles per bright pixel based on brightness
            const count = mode === 'burst' ? 1 : (brightness > 0.7 ? 2 : 1);
            for (let c = 0; c < count; c++) {
              if (particles.length >= MAX_P) break;
              const sx = scatterPx * (Math.random() - 0.5);
              const sy = scatterPx * (Math.random() - 0.5);
              const p = new Particle(
                px * scaleX + sx,
                py * scaleY + sy,
                brightness
              );
              if (mode === 'ghost') {
                p.alpha *= 0.4;
                p.size *= 1.6;
              }
              if (mode === 'chrome') {
                p.chromatic = Math.random() < 0.18;
              }
              particles.push(p);
            }
          }
        }
        document.getElementById('stat-particles').textContent = particles.length.toLocaleString();
      }

      // ---- Rendering ----
      // Chrome gradient — precomputed
      function getChromeGradient(ctx, x, y, r) {
        const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r * 2.2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.25, 'rgba(210,210,210,0.95)');
        g.addColorStop(0.5, 'rgba(140,140,140,0.85)');
        g.addColorStop(0.75, 'rgba(40,40,40,0.7)');
        g.addColorStop(1, 'rgba(200,200,200,0.4)');
        return g;
      }

      let frameCount = 0;
      let lastRebuild = 0;
      const REBUILD_INTERVAL = 80; // ms between full particle rebuild from video

      function draw(ts) {
        if (!state.running) return;
        requestAnimationFrame(draw);

        if (typeof grainsThisFrame !== 'undefined') grainsThisFrame = 0;

        frameCount++;
        const t = ts * 0.001;

        // Resize if needed
        if (mainCanvas.width !== window.innerWidth || mainCanvas.height !== window.innerHeight) {
          mainCanvas.width = window.innerWidth;
          mainCanvas.height = window.innerHeight;
        }

        // Rebuild particles from video at intervals
        if (state.running && video.readyState >= 2 && ts - lastRebuild > REBUILD_INTERVAL) {
          pixelCanvas.width = SAMPLE_W;
          pixelCanvas.height = SAMPLE_H;
          const imageData = sampleFrame();
          rebuildParticles(imageData);
          lastRebuild = ts;
        }

        // Clear
        if (mode === 'ghost') {
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
        } else {
          ctx.fillStyle = 'rgba(0,0,0,0.82)';
        }
        ctx.fillRect(0, 0, W(), H());

        // Get interaction point
        const ix = state.handActive ? state.handX * W() : -999;
        const iy = state.handActive ? state.handY * H() : -999;
        const repulseR = 80 + repulse * 260;
        const repulseStr = 0.3 + repulse * 2.4;

        // Hand openness drives particle size inflation in range
        const handOpen = state.handOpenness;

        // Update + draw particles
        ctx.save();

        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];

          // Noise drift (slowed down significantly)
          const nx = noise(p.ox * 0.008, p.oy * 0.008, t * 0.05 + p.noiseOff) * (scatter * 0.6 + 0.15);
          const ny = noise(p.ox * 0.008 + 100, p.oy * 0.008 + 100, t * 0.05 + p.noiseOff) * (scatter * 0.6 + 0.15);

          // Repulsion from hand/mouse
          let fx = 0, fy = 0;
          if (ix > -900) {
            const dx = p.x - ix;
            const dy = p.y - iy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < repulseR && dist > 0.5) {
              const force = Math.pow(1 - dist / repulseR, 1.8) * repulseStr;
              fx = (dx / dist) * force * 4;
              fy = (dy / dist) * force * 4;
              p.touch = 1;
              if (typeof triggerGrain === 'function') triggerGrain(p);
            }
          }

          p.vx = (p.vx + fx + nx * 0.1) * 0.86;
          p.vy = (p.vy + fy + ny * 0.1) * 0.86;

          // Return to origin
          const returnStr = mode === 'burst' ? 0.006 : 0.014;
          p.vx += (p.ox - p.x) * returnStr;
          p.vy += (p.oy - p.y) * returnStr;

          p.x += p.vx;
          p.y += p.vy;

          // touch decay for trail effect
          p.touch *= 0.9;

          // Draw
          const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
          const speedBoost = Math.min(speed * 0.12, 0.5);

          // Inflate particle size based on hand openness + proximity
          // Uses smooth cubic easing to prevent trembling
          let sizeInflation = 1;
          if (state.handActive && handOpen > 0.05) {
            const dx = p.x - ix;
            const dy = p.y - iy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const inflationR = repulseR * 2.5;
            if (dist < inflationR) {
              const proximity = 1 - dist / inflationR;
              // Smooth cubic ease-out curve instead of linear
              const smoothProx = proximity * proximity * (3 - 2 * proximity);
              sizeInflation = 1 + handOpen * smoothProx * 1.5;
            }
          }

          if (p.chromatic && mode !== 'portrait') {
            // Chrome/metallic particle
            const r = p.size * (1 + speedBoost * 1.5 + p.touch * 0.8) * sizeInflation;
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fillStyle = getChromeGradient(ctx, p.x, p.y, r);
            ctx.globalAlpha = p.alpha;
            ctx.fill();

            // Specular highlight
            ctx.beginPath();
            ctx.arc(p.x - r * 0.25, p.y - r * 0.25, r * 0.22, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255,255,255,0.9)';
            ctx.globalAlpha = 0.6;
            ctx.fill();
          } else if (p.chromatic) {
            // In portrait mode, chrome particles still have a subtle metallic look
            const r = p.size * (1.1 + p.touch * 0.7) * sizeInflation;
            const lum = Math.round(p.brightness * 255);
            ctx.beginPath();
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${lum},${lum},${lum},${p.alpha * 0.9})`;
            ctx.globalAlpha = 1;
            // thin ring
            ctx.strokeStyle = `rgba(255,255,255,0.55)`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
            ctx.fill();
          } else {
            // Standard monochrome particle
            const lum = Math.round(p.brightness * 255);
            const a = Math.min(1, p.alpha + speedBoost);
            const baseR = p.size * (1 + speedBoost * 0.5 + p.touch * 0.9) * sizeInflation;
            ctx.beginPath();
            ctx.arc(p.x, p.y, baseR, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${lum},${lum},${lum},${a})`;
            ctx.globalAlpha = 1;
            ctx.fill();
          }
        }

        ctx.restore();

        // Draw hand cursor indicator
        if (state.handActive || state.mouseX >= 0) {
          const cx = ix, cy = iy;
          ctx.save();
          ctx.globalAlpha = 0.18;
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(cx, cy, repulseR, 0, Math.PI * 2);
          ctx.stroke();
          // inner dot
          ctx.globalAlpha = 0.5;
          ctx.beginPath();
          ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.restore();
        }

        // Update P4TT3RNS hand logo position/scale
        const handLogo = document.getElementById('hand-logo');
        if (state.handActive && ix > -900) {
          // Since the text element is naturally 937px wide, we scale it down to fit the hand nicely.
          // At handOpen = 0 (closed), scale is 0.15 (~140px wide).
          // At handOpen = 1 (open), scale is 0.55 (~515px wide).
          const logoScale = 0.15 + handOpen * 0.40;
          const logoOpacity = 0.5 + handOpen * 0.5;
          handLogo.style.opacity = logoOpacity;
          handLogo.style.left = ix + 'px';
          handLogo.style.top = iy + 'px';
          handLogo.style.transform = `translate(-50%, -50%) scale(${logoScale})`;
        } else {
          handLogo.style.opacity = '0';
        }

        // Mode-specific overlays
        if (mode === 'chrome') drawChromeRing(ctx, t);
        if (mode === 'burst') drawBurstHalo(ctx, ix, iy, t);

        // Update stats
        document.getElementById('hand-stats').innerHTML =
          `hand x ${state.handActive ? state.handX.toFixed(2) : '—'}<br>` +
          `hand y ${state.handActive ? state.handY.toFixed(2) : '—'}<br>` +
          `field ∅ ${Math.round(repulseR)}px`;
      }

      function drawChromeRing(ctx, t) {
        const cx = W() / 2, cy = H() / 2;
        const r = Math.min(W(), H()) * 0.38;
        ctx.save();
        ctx.globalAlpha = 0.06 + Math.sin(t * 0.7) * 0.02;
        const g = ctx.createConicalGradient ? null : null; // fallback
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(cx, cy, r * (0.88 + i * 0.08) + Math.sin(t + i) * 6, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      function drawBurstHalo(ctx, ix, iy, t) {
        if (ix < 0) return;
        ctx.save();
        for (let i = 0; i < 3; i++) {
          const r = 60 + i * 40 + Math.sin(t * 3 + i) * 12;
          ctx.beginPath();
          ctx.arc(ix, iy, r, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,255,255,${0.05 - i * 0.012})`;
          ctx.lineWidth = 0.8;
          ctx.globalAlpha = 1;
          ctx.stroke();
        }
        ctx.restore();
      }

      // ---- Mouse as hand fallback ----
      mainCanvas.addEventListener('mousemove', e => {
        state.mouseX = e.clientX;
        state.mouseY = e.clientY;
      });
      mainCanvas.addEventListener('mouseleave', () => {
        state.mouseX = -1;
        state.mouseY = -1;
      });

      // Touch
      mainCanvas.addEventListener('touchmove', e => {
        e.preventDefault();
        const t = e.touches[0];
        state.mouseX = t.clientX;
        state.mouseY = t.clientY;
      }, { passive: false });
      mainCanvas.addEventListener('touchend', () => {
        state.mouseX = -1;
        state.mouseY = -1;
      });

      // ---- Mode buttons ----
      document.querySelectorAll('[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
          mode = btn.dataset.mode;
          document.getElementById('stat-mode').textContent = mode;
          document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('active', b === btn));
          if (typeof switchModeSoundscape === 'function') switchModeSoundscape(mode);
        });
      });

      // ---- Sliders ----
      document.getElementById('s-density').addEventListener('input', e => { density = e.target.value / 100; });
      document.getElementById('s-scatter').addEventListener('input', e => { scatter = e.target.value / 100; });
      document.getElementById('s-thresh').addEventListener('input', e => { threshold = e.target.value / 100; });

      // ---- Camera init ----
      permBtn.addEventListener('click', startCamera);

      async function startCamera() {
        permBtn.textContent = 'Initialising…';
        permBtn.disabled = true;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
            audio: false
          });
          video.srcObject = stream;
          video.onloadedmetadata = () => {
            video.play();
            mainCanvas.width = window.innerWidth;
            mainCanvas.height = window.innerHeight;
            state.running = true;
            if (typeof Tone !== 'undefined') {
              Tone.start().then(() => initAudio());
            } else {
              initAudio();
            }
            permOverlay.style.transition = 'opacity 0.6s';
            permOverlay.style.opacity = '0';
            setTimeout(() => permOverlay.style.display = 'none', 650);

            // Init MediaPipe Hands
            hands = new Hands({
              locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
            });
            hands.setOptions({
              maxNumHands: 1,
              modelComplexity: 1,
              minDetectionConfidence: 0.6,
              minTrackingConfidence: 0.5
            });
            hands.onResults((results) => {
              const landmarks = results.multiHandLandmarks;
              if (landmarks && landmarks.length > 0) {
                const hand = landmarks[0];
                // Use index finger MCP (landmark 9) as interaction point
                const p = hand[9];
                const targetX = 1 - p.x; // mirror horizontally
                const targetY = p.y;
                // light de-jitter, realtime response
                state.handX += (targetX - state.handX) * 0.35;
                state.handY += (targetY - state.handY) * 0.35;
                state.handActive = true;

                // Hand openness: avg distance from palm center (landmark 0) to fingertips (4,8,12,16,20)
                const palm = hand[0];
                const tips = [4, 8, 12, 16, 20];
                let avgDist = 0;
                for (const ti of tips) {
                  const dx = hand[ti].x - palm.x;
                  const dy = hand[ti].y - palm.y;
                  avgDist += Math.sqrt(dx * dx + dy * dy);
                }
                avgDist /= tips.length;
                // normalize: closed ~0.06, open ~0.22
                const openness = Math.max(0, Math.min(1, (avgDist - 0.06) / 0.16));
                // smooth repulse value
                repulse += (openness - repulse) * 0.12;
                // store openness for particle size inflation
                state.handOpenness += (openness - state.handOpenness) * 0.15;

                // Hand velocity for audio modulation
                if (state.prevHandX > -1) {
                  state.handVelX = state.handX - state.prevHandX;
                  state.handVelY = state.handY - state.prevHandY;
                }
                state.prevHandX = state.handX;
                state.prevHandY = state.handY;

                // Update audio engine
                updateAudio(state.handX, state.handY, openness,
                  Math.sqrt(state.handVelX * state.handVelX + state.handVelY * state.handVelY));
              } else {
                state.handActive = false;
                state.handOpenness *= 0.92;
                fadeAudio();
              }
            });

            const processHands = async () => {
              if (!state.running || !hands) return;
              await hands.send({ image: video });
              requestAnimationFrame(processHands);
            };
            requestAnimationFrame(processHands);

            requestAnimationFrame(draw);
          };
        } catch (err) {
          errorMsg.style.display = 'block';
          if (err.name === 'NotAllowedError') {
            errorMsg.textContent = 'Camera access denied. Allow camera permissions and reload.';
          } else {
            errorMsg.textContent = 'Could not access camera: ' + err.message;
            // Fallback: run in demo mode with mouse only
            mainCanvas.width = window.innerWidth;
            mainCanvas.height = window.innerHeight;
            state.running = true;
            permOverlay.style.transition = 'opacity 0.8s';
            permOverlay.style.opacity = '0';
            setTimeout(() => permOverlay.style.display = 'none', 850);
            // Generate static particle field as demo
            generateDemoField();
            requestAnimationFrame(draw);
          }
          permBtn.textContent = 'Retry';
          permBtn.disabled = false;
        }
      }

      function generateDemoField() {
        // Create a face-shaped particle field for demo purposes
        particles.length = 0;
        const cx = W() / 2, cy = H() / 2;
        const rx = W() * 0.18, ry = H() * 0.28;
        for (let i = 0; i < 18000; i++) {
          const theta = Math.random() * Math.PI * 2;
          const rr = Math.random();
          // Face oval
          const px = cx + rx * (rr * Math.cos(theta)) * (0.7 + Math.random() * 0.6);
          const py = cy + ry * (rr * Math.sin(theta)) * (0.7 + Math.random() * 0.6);
          const dist = Math.sqrt(Math.pow((px - cx) / rx, 2) + Math.pow((py - cy) / ry, 2));
          const brightness = Math.max(0, 1 - dist * dist) * (0.4 + Math.random() * 0.6);
          if (brightness < 0.04) continue;
          const p = new Particle(px, py, brightness);
          if (Math.random() < 0.04) p.chromatic = true;
          particles.push(p);
        }
        document.getElementById('stat-particles').textContent = particles.length.toLocaleString();
      }

      // ---- Audio Engine (Tone.js) ----
      let audioStarted = false;
      let grainsThisFrame = 0;
      
      // Nodes
      let masterVol, masterComp, masterReverb, pannerX;
      let droneOsc, droneFilter, droneLfo, droneVol;
      let currentModeNodes = [];
      let grainSynths = [];
      let grainIndex = 0;
      const MAX_GRAINS_PER_FRAME = 2;
      
      const pentatonicScale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99, 880.00, 1046.50];

      async function initAudio() {
        if (audioStarted) return;
        await Tone.start();
        
        masterVol = new Tone.Volume(-Infinity).toDestination();
        masterComp = new Tone.Compressor({ threshold: -24, ratio: 6, knee: 12 });
        masterReverb = new Tone.Reverb({ decay: 4 }).connect(masterComp);
        masterReverb.wet.value = 0.4;
        await masterReverb.ready;
        
        pannerX = new Tone.Panner(0).connect(masterReverb);
        masterComp.connect(masterVol);

        // Breathing drone (Always on)
        droneVol = new Tone.Volume(-12).connect(pannerX);
        droneFilter = new Tone.Filter(200, "lowpass").connect(droneVol);
        droneOsc = new Tone.Oscillator(55, "sine").connect(droneFilter).start();
        droneLfo = new Tone.LFO(0.1, 100, 400).connect(droneFilter.frequency).start();

        // Setup grains
        for (let i = 0; i < 6; i++) {
          const synth = new Tone.FMSynth({
            envelope: { attack: 0.01, decay: 0.1, sustain: 0, release: 0.1 },
            modulationIndex: 2
          }).connect(pannerX);
          grainSynths.push(synth);
        }

        switchModeSoundscape(mode);
        audioStarted = true;
        masterVol.volume.rampTo(-6, 1);
      }

      function switchModeSoundscape(newMode) {
        if (!audioStarted) return;
        currentModeNodes.forEach(node => {
          if (node.stop) node.stop();
          node.dispose();
        });
        currentModeNodes = [];
        
        if (newMode === 'portrait') {
          const chorus = new Tone.Chorus(4, 2.5, 0.5).connect(pannerX).start();
          const pad = new Tone.Synth({ oscillator: { type: "sawtooth" } }).connect(chorus);
          currentModeNodes.push(chorus, pad);
          droneOsc.type = "sine";
          masterReverb.decay = 4;
        } else if (newMode === 'ghost') {
          const delay = new Tone.FeedbackDelay("8n", 0.5).connect(pannerX);
          const phaser = new Tone.Phaser({ frequency: 0.5, octaves: 3, baseFrequency: 200 }).connect(delay);
          const noise = new Tone.Noise("pink").connect(phaser).start();
          noise.volume.value = -20;
          currentModeNodes.push(delay, phaser, noise);
          droneOsc.type = "triangle";
          masterReverb.decay = 8;
        } else if (newMode === 'chrome') {
          const cheby = new Tone.Chebyshev(50).connect(pannerX);
          const fm = new Tone.FMOscillator("C2", "square", "square").connect(cheby).start();
          fm.volume.value = -15;
          currentModeNodes.push(cheby, fm);
          droneOsc.type = "square";
          masterReverb.decay = 3;
        } else if (newMode === 'burst') {
          const dist = new Tone.Distortion(0.8).connect(pannerX);
          const rumble = new Tone.Noise("brown").connect(dist).start();
          rumble.volume.value = -10;
          currentModeNodes.push(dist, rumble);
          droneOsc.type = "sawtooth";
          masterReverb.decay = 2;
        }
      }

      function updateAudio(handX, handY, openness, velocity) {
        if (!audioStarted || audioMuted) return;
        
        pannerX.pan.rampTo((handX * 2) - 1, 0.1);
        
        const yInv = 1 - handY;
        const basePitch = 40 + yInv * 80;
        droneOsc.frequency.rampTo(basePitch, 0.1);

        const vel = Math.min(velocity * 40, 1);
        droneLfo.frequency.rampTo(0.1 + vel * 5, 0.1);

        droneVol.volume.rampTo(-12 + openness * 10, 0.1);
        masterVol.volume.rampTo(-6, 0.1);
      }

      let lastGrainTime = 0;
      function triggerGrain(p) {
        if (!audioStarted || audioMuted) return;
        if (grainsThisFrame >= MAX_GRAINS_PER_FRAME) return;
        const now = Tone.now();
        if (now - lastGrainTime < 0.02) return; 
        
        const synth = grainSynths[grainIndex];
        grainIndex = (grainIndex + 1) % grainSynths.length;
        
        const noteIdx = Math.floor(p.brightness * (pentatonicScale.length - 1));
        const freq = pentatonicScale[noteIdx];
        
        const vel = Math.min(1, p.touch * 0.5 + 0.1);
        
        synth.triggerAttackRelease(freq, "32n", now, vel);
        grainsThisFrame++;
        lastGrainTime = now;
      }

      function fadeAudio() {
        if (!audioStarted || !masterVol) return;
        masterVol.volume.rampTo(-Infinity, 0.8);
      }

      // Mute button handler
      document.getElementById('btn-mute').addEventListener('click', function () {
        audioMuted = !audioMuted;
        this.textContent = audioMuted ? '♪ Off' : '♪ On';
        this.classList.toggle('active', !audioMuted);
        if (audioMuted && audioStarted && masterVol) {
          masterVol.volume.rampTo(-Infinity, 0.2);
        } else if (!audioMuted && audioStarted && masterVol) {
          masterVol.volume.rampTo(-6, 0.2);
        }
      });

      // Auto-start hint
      permBtn.focus();
      window.addEventListener('resize', () => {
        mainCanvas.width = window.innerWidth;
        mainCanvas.height = window.innerHeight;
      });
    })();
</body>

</html>
