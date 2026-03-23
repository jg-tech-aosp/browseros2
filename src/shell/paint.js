/**
 * BrowserOS v2 — Paint (Native System Component)
 * src/shell/paint.js
 */

export function registerPaint({ wm, fs }) {

  wm.registerSystemApp('paint', {
    title:  'Paint',
    icon:   '🎨',
    width:  860,
    height: 580,
    mount(container, instanceId, args) {
      const COLORS = ['#000000','#ffffff','#ff0000','#ff6600','#ffcc00','#00cc00','#0066ff','#9900cc','#ff66cc','#00cccc','#663300','#999999','#cccccc','#004499','#006600','#990000'];
      const state = { tool:'brush', color:'#000000', size:8, drawing:false, lastX:0, lastY:0, history:[], histPos:-1 };

      container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--wm-bg)';

      // ── Toolbar ─────────────────────────────────────────────────────────────
      const toolbar = document.createElement('div');
      toolbar.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;background:rgba(0,0,0,0.2);border-bottom:1px solid var(--wm-border);flex-wrap:wrap;flex-shrink:0';
      container.appendChild(toolbar);

      // Tools
      const TOOLS = [
        { id:'brush',      label:'✏️',  title:'Brush' },
        { id:'eraser',     label:'⬜',  title:'Eraser' },
        { id:'fill',       label:'🪣',  title:'Fill' },
        { id:'line',       label:'╱',   title:'Line' },
        { id:'rect',       label:'▭',   title:'Rectangle' },
        { id:'circle',     label:'○',   title:'Ellipse' },
        { id:'eyedropper', label:'💉',  title:'Eyedropper' },
      ];

      const toolsDiv = document.createElement('div');
      toolsDiv.style.cssText = 'display:flex;gap:3px';
      toolbar.appendChild(toolsDiv);

      TOOLS.forEach(t => {
        const btn = document.createElement('button');
        btn.textContent = t.label; btn.title = t.title;
        btn.style.cssText = 'width:28px;height:28px;border-radius:4px;border:1px solid rgba(255,255,255,0.1);' +
          'background:' + (t.id === 'brush' ? 'rgba(0,120,212,0.4)' : 'rgba(255,255,255,0.07)') + ';' +
          'color:var(--wm-text);cursor:pointer;font-size:14px;transition:background 0.1s';
        btn.onclick = () => {
          state.tool = t.id;
          toolsDiv.querySelectorAll('button').forEach(b => b.style.background = 'rgba(255,255,255,0.07)');
          btn.style.background = 'rgba(0,120,212,0.4)';
        };
        toolsDiv.appendChild(btn);
      });

      function sep() {
        const d = document.createElement('div');
        d.style.cssText = 'width:1px;height:24px;background:rgba(255,255,255,0.1)';
        toolbar.appendChild(d);
      }
      sep();

      // Size
      const sizeLabel = document.createElement('span');
      sizeLabel.textContent = 'Size'; sizeLabel.style.cssText = 'font-size:11px;color:var(--wm-text-dim)';
      toolbar.appendChild(sizeLabel);
      const sizeSlider = document.createElement('input');
      sizeSlider.type = 'range'; sizeSlider.min = 1; sizeSlider.max = 60; sizeSlider.value = 8;
      sizeSlider.style.cssText = 'width:80px;cursor:pointer';
      toolbar.appendChild(sizeSlider);
      const sizeVal = document.createElement('span');
      sizeVal.textContent = '8px'; sizeVal.style.cssText = 'font-size:11px;color:var(--wm-text-dim);width:28px';
      toolbar.appendChild(sizeVal);
      sizeSlider.oninput = () => { state.size = parseInt(sizeSlider.value); sizeVal.textContent = state.size + 'px'; };
      sep();

      // Palette
      const paletteDiv = document.createElement('div');
      paletteDiv.style.cssText = 'display:flex;gap:2px;flex-wrap:wrap;max-width:180px';
      toolbar.appendChild(paletteDiv);
      COLORS.forEach(c => {
        const sw = document.createElement('div');
        sw.style.cssText = 'width:16px;height:16px;border-radius:2px;background:' + c + ';cursor:pointer;border:1px solid rgba(255,255,255,0.15)';
        sw.onclick = () => setColor(c);
        paletteDiv.appendChild(sw);
      });
      sep();

      const picker = document.createElement('input');
      picker.type = 'color'; picker.value = '#000000';
      picker.style.cssText = 'width:28px;height:28px;border:none;background:none;cursor:pointer;padding:0';
      picker.oninput = () => setColor(picker.value);
      toolbar.appendChild(picker);

      const curColor = document.createElement('div');
      curColor.style.cssText = 'width:28px;height:28px;border-radius:4px;border:2px solid rgba(255,255,255,0.3);background:#000000';
      toolbar.appendChild(curColor);

      function setColor(c) { state.color = c; curColor.style.background = c; picker.value = c; }
      sep();

      const clearBtn = document.createElement('button');
      clearBtn.textContent = 'Clear';
      clearBtn.style.cssText = 'background:rgba(255,80,80,0.15);border:1px solid rgba(255,80,80,0.3);color:#ff8888;border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer';
      toolbar.appendChild(clearBtn);

      const undoBtn = document.createElement('button');
      undoBtn.textContent = 'Undo';
      undoBtn.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);color:var(--wm-text);border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer';
      toolbar.appendChild(undoBtn);

      const redoBtn = document.createElement('button');
      redoBtn.textContent = 'Redo';
      redoBtn.style.cssText = 'background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);color:var(--wm-text);border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer';
      toolbar.appendChild(redoBtn);

      const saveBtn = document.createElement('button');
      saveBtn.textContent = '💾 Save';
      saveBtn.style.cssText = 'background:rgba(0,120,212,0.2);border:1px solid rgba(0,120,212,0.4);color:#66aaff;border-radius:4px;padding:3px 8px;font-size:12px;cursor:pointer';
      toolbar.appendChild(saveBtn);

      // ── Canvas ───────────────────────────────────────────────────────────────
      const canvasWrap = document.createElement('div');
      canvasWrap.style.cssText = 'flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;background:#2a2a2a;min-height:0';
      container.appendChild(canvasWrap);

      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 500;
      canvas.style.cssText = 'display:block;cursor:crosshair;box-shadow:0 4px 24px rgba(0,0,0,0.6)';
      canvasWrap.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 800, 500);

      // ── Status bar ────────────────────────────────────────────────────────────
      const statusBar = document.createElement('div');
      statusBar.style.cssText = 'padding:3px 8px;font-size:11px;color:var(--wm-text-dim);background:rgba(0,0,0,0.2);border-top:1px solid var(--wm-border);flex-shrink:0';
      statusBar.textContent = 'Ready';
      container.appendChild(statusBar);

      // ── Undo/redo ─────────────────────────────────────────────────────────────
      function snapshot() {
        state.history = state.history.slice(0, state.histPos + 1);
        state.history.push(canvas.toDataURL());
        state.histPos = state.history.length - 1;
        if (state.history.length > 40) { state.history.shift(); state.histPos--; }
      }

      function restore(dataUrl) {
        const img = new Image(); img.src = dataUrl;
        img.onload = () => { ctx.clearRect(0, 0, 800, 500); ctx.drawImage(img, 0, 0); };
      }

      snapshot();

      clearBtn.onclick = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 800, 500); snapshot(); };
      undoBtn.onclick  = () => { if (state.histPos > 0) { state.histPos--; restore(state.history[state.histPos]); }};
      redoBtn.onclick  = () => { if (state.histPos < state.history.length - 1) { state.histPos++; restore(state.history[state.histPos]); }};

      saveBtn.onclick = async () => {
        const name = prompt('Save as (in /Pictures/):', 'drawing.png');
        if (!name) return;
        await fs.write('/Pictures/' + name, canvas.toDataURL('image/png'));
        wm.notify('Saved to /Pictures/' + name);
      };

      // ── Fill ──────────────────────────────────────────────────────────────────
      function hexToRgb(h) { return [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]; }

      function floodFill(x, y, fc) {
        const id = ctx.getImageData(0, 0, 800, 500), d = id.data;
        const idx = (x, y) => (y * 800 + x) * 4;
        const ti = idx(x, y), tr = [d[ti], d[ti+1], d[ti+2]], fc2 = hexToRgb(fc);
        if (tr[0]===fc2[0] && tr[1]===fc2[1] && tr[2]===fc2[2]) return;
        const stack = [[x, y]];
        while (stack.length) {
          const [cx, cy] = stack.pop();
          if (cx < 0 || cx >= 800 || cy < 0 || cy >= 500) continue;
          const i = idx(cx, cy);
          if (d[i]!==tr[0] || d[i+1]!==tr[1] || d[i+2]!==tr[2]) continue;
          d[i]=fc2[0]; d[i+1]=fc2[1]; d[i+2]=fc2[2]; d[i+3]=255;
          stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
        }
        ctx.putImageData(id, 0, 0);
      }

      function getPixel(x, y) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        return '#' + [d[0],d[1],d[2]].map(v => v.toString(16).padStart(2,'0')).join('');
      }

      function getPos(e) {
        const r = canvas.getBoundingClientRect();
        return { x: Math.round(e.clientX - r.left), y: Math.round(e.clientY - r.top) };
      }

      // ── Drawing ───────────────────────────────────────────────────────────────
      let shapeStart = null, shapeSnap = null;

      canvas.addEventListener('mousedown', e => {
        const p = getPos(e);
        if (state.tool === 'eyedropper') { setColor(getPixel(p.x, p.y)); return; }
        if (state.tool === 'fill') { snapshot(); floodFill(p.x, p.y, state.color); snapshot(); return; }
        state.drawing = true; state.lastX = p.x; state.lastY = p.y;
        shapeStart = p; shapeSnap = canvas.toDataURL();
        if (state.tool === 'brush' || state.tool === 'eraser') {
          ctx.beginPath(); ctx.arc(p.x, p.y, state.size/2, 0, Math.PI*2);
          ctx.fillStyle = state.tool === 'eraser' ? '#ffffff' : state.color; ctx.fill();
        }
      });

      canvas.addEventListener('mousemove', e => {
        const p = getPos(e);
        statusBar.textContent = state.tool + ' • x:' + p.x + ' y:' + p.y + ' • size:' + state.size + 'px';
        if (!state.drawing) return;

        if (state.tool === 'brush' || state.tool === 'eraser') {
          ctx.beginPath(); ctx.moveTo(state.lastX, state.lastY); ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = state.tool === 'eraser' ? '#ffffff' : state.color;
          ctx.lineWidth = state.size; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
          ctx.beginPath(); ctx.arc(p.x, p.y, state.size/2, 0, Math.PI*2);
          ctx.fillStyle = state.tool === 'eraser' ? '#ffffff' : state.color; ctx.fill();
          state.lastX = p.x; state.lastY = p.y;
        } else {
          const img = new Image(); img.src = shapeSnap;
          img.onload = () => {
            ctx.clearRect(0, 0, 800, 500); ctx.drawImage(img, 0, 0);
            ctx.strokeStyle = state.color; ctx.lineWidth = state.size; ctx.lineCap = 'round';
            if (state.tool === 'line') {
              ctx.beginPath(); ctx.moveTo(shapeStart.x, shapeStart.y); ctx.lineTo(p.x, p.y); ctx.stroke();
            } else if (state.tool === 'rect') {
              ctx.strokeRect(shapeStart.x, shapeStart.y, p.x - shapeStart.x, p.y - shapeStart.y);
            } else if (state.tool === 'circle') {
              const rx = (p.x - shapeStart.x) / 2, ry = (p.y - shapeStart.y) / 2;
              ctx.beginPath(); ctx.ellipse(shapeStart.x + rx, shapeStart.y + ry, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI*2); ctx.stroke();
            }
          };
        }
      });

      canvas.addEventListener('mouseup',    () => { if (!state.drawing) return; state.drawing = false; snapshot(); });
      canvas.addEventListener('mouseleave', () => { if (state.drawing) { state.drawing = false; snapshot(); }});

      // ── Keyboard shortcuts ────────────────────────────────────────────────────
      container.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key === 'z') { undoBtn.click(); e.preventDefault(); }
        if (e.ctrlKey && e.key === 'y') { redoBtn.click(); e.preventDefault(); }
        if (e.ctrlKey && e.key === 's') { saveBtn.click(); e.preventDefault(); }
      });

      // ── Load image from args ──────────────────────────────────────────────────
      if (args?.file) {
        fs.read(args.file).then(content => {
          if (!content) { wm.notify('Could not open: ' + args.file); return; }
          const img = new Image();
          img.onload = () => {
            ctx.clearRect(0, 0, 800, 500);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 800, 500);
            ctx.drawImage(img, 0, 0, Math.min(img.width, 800), Math.min(img.height, 500));
            snapshot();
            wm.setWindowTitle(instanceId, '🎨 Paint — ' + args.file.split('/').pop());
          };
          img.src = content;
        });
      }
    }
  });
}
