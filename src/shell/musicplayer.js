/**
 * BrowserOS v2 — Music Player (Native System Component)
 * src/shell/musicplayer.js
 */

export function registerMusicPlayer({ wm, fs }) {

  wm.registerSystemApp('musicplayer', {
    title:  'Music Player',
    icon:   '🎵',
    width:  380,
    height: 480,
    mount(container, instanceId, args) {
      let audio    = new Audio();
      let playlist = [];
      let currentIdx = -1;

      container.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow:hidden;background:var(--wm-bg);color:var(--wm-text);align-items:center;padding:20px;gap:12px;box-sizing:border-box';

      // Album art
      const art = document.createElement('div');
      art.style.cssText = 'width:160px;height:160px;border-radius:12px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;font-size:56px;flex-shrink:0';
      art.textContent = '🎵';
      container.appendChild(art);

      // Track info
      const trackName = document.createElement('div');
      trackName.style.cssText = 'font-size:15px;font-weight:bold;text-align:center;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--wm-text)';
      trackName.textContent = 'No track selected';
      container.appendChild(trackName);

      const trackSub = document.createElement('div');
      trackSub.style.cssText = 'font-size:12px;color:var(--wm-text-dim);text-align:center';
      trackSub.textContent = args?.file ? 'Loading...' : 'Open /Music folder or drop a file';
      container.appendChild(trackSub);

      // Progress
      const progressWrap = document.createElement('div');
      progressWrap.style.cssText = 'width:100%;display:flex;align-items:center;gap:8px';
      const timeEl = document.createElement('span');
      timeEl.style.cssText = 'font-size:11px;color:var(--wm-text-dim);width:36px';
      timeEl.textContent = '0:00';
      const progressBar = document.createElement('input');
      progressBar.type = 'range'; progressBar.min = 0; progressBar.max = 100; progressBar.value = 0;
      progressBar.style.cssText = 'flex:1;cursor:pointer;accent-color:var(--wm-accent)';
      const durationEl = document.createElement('span');
      durationEl.style.cssText = 'font-size:11px;color:var(--wm-text-dim);width:36px;text-align:right';
      durationEl.textContent = '0:00';
      progressWrap.appendChild(timeEl);
      progressWrap.appendChild(progressBar);
      progressWrap.appendChild(durationEl);
      container.appendChild(progressWrap);

      // Controls
      const controls = document.createElement('div');
      controls.style.cssText = 'display:flex;align-items:center;gap:12px';

      function mkCtrlBtn(icon, size) {
        const b = document.createElement('button');
        b.textContent = icon;
        b.style.cssText = `background:transparent;border:none;color:var(--wm-text);cursor:pointer;font-size:${size||22}px;width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;transition:background 0.15s`;
        b.onmouseenter = () => b.style.background = 'rgba(255,255,255,0.1)';
        b.onmouseleave = () => b.style.background = 'transparent';
        return b;
      }

      const prevBtn = mkCtrlBtn('⏮');
      const playBtn = mkCtrlBtn('▶', 28);
      playBtn.style.background = 'var(--wm-accent)';
      playBtn.style.color = '#fff';
      playBtn.onmouseenter = () => playBtn.style.filter = 'brightness(1.15)';
      playBtn.onmouseleave = () => playBtn.style.filter = '';
      const nextBtn = mkCtrlBtn('⏭');

      controls.appendChild(prevBtn);
      controls.appendChild(playBtn);
      controls.appendChild(nextBtn);
      container.appendChild(controls);

      // Playlist
      const playlistEl = document.createElement('div');
      playlistEl.style.cssText = 'width:100%;flex:1;overflow-y:auto;border:1px solid var(--wm-border);border-radius:8px;background:rgba(255,255,255,0.03);min-height:0';
      container.appendChild(playlistEl);

      // Load button
      const loadBtn = document.createElement('button');
      loadBtn.textContent = '📁 Load /Music';
      loadBtn.style.cssText = 'background:rgba(0,120,212,0.2);border:1px solid rgba(0,120,212,0.4);color:#66aaff;border-radius:6px;padding:6px 16px;font-size:13px;cursor:pointer;width:100%;flex-shrink:0';
      container.appendChild(loadBtn);

      // ── Helpers ─────────────────────────────────────────────────────────────

      function fmt(s) {
        const m = Math.floor(s / 60), sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
      }

      function renderPlaylist() {
        playlistEl.innerHTML = '';
        if (!playlist.length) {
          playlistEl.innerHTML = '<div style="padding:16px;color:var(--wm-text-dim);font-size:12px;text-align:center">No tracks loaded</div>';
          return;
        }
        playlist.forEach((track, i) => {
          const el = document.createElement('div');
          const active = i === currentIdx;
          el.style.cssText = `padding:8px 12px;font-size:13px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;align-items:center;gap:8px;${active ? 'background:rgba(0,120,212,0.2);color:var(--wm-accent)' : 'color:var(--wm-text)'}`;
          el.innerHTML = `<span style="flex-shrink:0">${active ? '▶' : '🎵'}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${track.name}</span>`;
          el.onclick = () => playTrack(i);
          playlistEl.appendChild(el);
        });
      }

      function playTrack(idx) {
        if (idx < 0 || idx >= playlist.length) return;
        currentIdx = idx;
        const track = playlist[idx];
        trackName.textContent = track.name;
        trackSub.textContent  = playlist.length + ' track' + (playlist.length !== 1 ? 's' : '') + ' in playlist';
        audio.src = track.src;
        audio.play();
        playBtn.textContent = '⏸';
        renderPlaylist();
        wm.setWindowTitle(instanceId, '🎵 ' + track.name);
      }

      // ── Audio events ─────────────────────────────────────────────────────────

      audio.addEventListener('timeupdate', () => {
        if (!audio.duration) return;
        progressBar.value = (audio.currentTime / audio.duration) * 100;
        timeEl.textContent     = fmt(audio.currentTime);
        durationEl.textContent = fmt(audio.duration);
      });

      audio.addEventListener('ended', () => {
        if (currentIdx < playlist.length - 1) playTrack(currentIdx + 1);
        else { playBtn.textContent = '▶'; currentIdx = -1; renderPlaylist(); }
      });

      progressBar.oninput = () => {
        if (audio.duration) audio.currentTime = (progressBar.value / 100) * audio.duration;
      };

      // ── Controls ─────────────────────────────────────────────────────────────

      playBtn.onclick = () => {
        if (audio.src && audio.paused) { audio.play(); playBtn.textContent = '⏸'; }
        else if (!audio.paused)        { audio.pause(); playBtn.textContent = '▶'; }
        else if (playlist.length > 0)  { playTrack(0); }
      };

      prevBtn.onclick = () => playTrack(Math.max(0, currentIdx - 1));
      nextBtn.onclick = () => playTrack(Math.min(playlist.length - 1, currentIdx + 1));

      // ── Load /Music ──────────────────────────────────────────────────────────

      loadBtn.onclick = async () => {
        const items = await fs.ls('/Music') || [];
        const tracks = items.filter(i => i.name.match(/\.(mp3|wav|ogg)$/i));
        playlist = [];
        for (const track of tracks) {
          const content = await fs.read('/Music/' + track.name);
          if (content) playlist.push({ name: track.name, src: content });
        }
        if (!playlist.length) {
          wm.notify('No audio files found in /Music');
        } else {
          trackSub.textContent = playlist.length + ' track' + (playlist.length !== 1 ? 's' : '') + ' loaded';
          wm.notify('Loaded ' + playlist.length + ' tracks');
        }
        renderPlaylist();
      };

      // ── Auto-play from args ───────────────────────────────────────────────────

      if (args?.file) {
        const path = args.file;
        const name = path.split('/').pop();
        fs.read(path).then(content => {
          if (!content) { wm.notify('Could not read: ' + name); return; }
          playlist    = [{ name, src: content }];
          currentIdx  = -1;
          renderPlaylist();
          playTrack(0);
        });
      } else {
        renderPlaylist();
      }
    }
  });
}
