/**
 * Dreaming Spanish Enhancer - Hide Video UI Module
 * Injects a "Hide video" option into the DS 3-dots menu and renders
 * a collapsible "Hidden videos" section on the /library page.
 */

const HideVideoUI = {
  // ---- Storage ----

  loadHiddenVideos() {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_HIDDEN_VIDEOS' }, response => {
        if (chrome.runtime?.lastError) { resolve([]); return; }
        resolve(response?.videos || []);
      });
    });
  },

  // ---- Video Data Extraction ----

  /**
   * Extract video metadata from a card DOM element.
   * Uses ordered fallback selectors since DS class names may change.
   */
  extractVideoData(cardEl) {
    if (!cardEl) return {};

    // slug / id from the first <a> href
    const link = cardEl.querySelector('a[href*="/videos/"], a[href*="/watch/"]') ||
                  cardEl.querySelector('a[href]');
    const href = link?.getAttribute('href') || '';

    // slug: last meaningful path segment
    const slugMatch = href.match(/\/(?:videos|watch)\/([^/?#]+)/);
    const slug = slugMatch ? slugMatch[1] : (href.split('/').filter(Boolean).pop() || '');

    // id: 24-char hex from URL, or fall back to slug
    const idMatch = href.match(/[a-f0-9]{24}/);
    const id = idMatch ? idMatch[0] : slug;

    // title
    const titleEl =
      cardEl.querySelector('[class*="title" i]') ||
      cardEl.querySelector('h3, h2, h4') ||
      link;
    const title = (titleEl?.textContent || '').trim().replace(/\s+/g, ' ');

    // thumbnail
    const img = cardEl.querySelector('img');
    const thumbnail = img?.src || img?.dataset?.src || '';

    // duration — look for text like "9:04" or "1:12:06"
    const durationEl = cardEl.querySelector('[class*="duration" i], [class*="time" i]');
    const durationText = durationEl?.textContent?.trim() || '';
    const duration = /\d+:\d+/.test(durationText) ? durationText : '';

    // level badge
    const levelEl = cardEl.querySelector('[class*="level" i], [class*="badge" i]');
    const levelText = (levelEl?.textContent || '').toLowerCase().trim();
    const level = ['superbeginner', 'beginner', 'intermediate', 'advanced'].find(l => levelText.includes(l)) || '';

    return { id, slug, title, thumbnail, duration, level };
  },

  // ---- Menu Injection ----

  /**
   * Inject a "Hide video" option into the DS native dropdown menu.
   * @param {Element} menuEl - The dropdown menu element
   * @param {Object} videoData - Video metadata
   * @param {Function} onHide - Callback when user clicks "Hide video"
   */
  injectMenuOption(menuEl, videoData, onHide) {
    if (menuEl.querySelector('.ds-hide-menu-item')) return; // already injected

    const item = document.createElement('div');
    item.className = 'ds-hide-menu-item';
    item.setAttribute('role', 'menuitem');
    item.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
      <span>Hide video</span>
    `;

    item.addEventListener('click', e => {
      e.stopPropagation();
      onHide();
    });

    menuEl.appendChild(item);
  },

  // ---- Library Section ----

  /**
   * Build and return the "Hidden videos" collapsible section element.
   */
  createSection(videos, isDark) {
    const section = document.createElement('div');
    section.id = 'ds-hidden-section';
    section.className = 'ds-card' + (isDark ? ' ds-dark' : '');

    section.innerHTML = this._buildSectionHtml(videos);
    this._wireSectionEvents(section, videos);
    return section;
  },

  _buildSectionHtml(videos) {
    return `
      <div class="ds-hidden-header">
        <span class="ds-hidden-title">Hidden videos (${videos.length})</span>
        <svg class="ds-hidden-chevron" xmlns="http://www.w3.org/2000/svg"
             width="20" height="20" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
      <div class="ds-hidden-body collapsed">
        ${videos.length === 0
          ? '<p class="ds-hidden-empty">No hidden videos yet.</p>'
          : `<div class="ds-hidden-grid">${videos.map(v => this._buildVideoCardHtml(v)).join('')}</div>`
        }
      </div>
    `;
  },

  _buildVideoCardHtml(video) {
    const levelClass = video.level ? `ds-level-${video.level.replace(' ', '')}` : '';
    return `
      <div class="ds-hidden-video-card" data-video-id="${this._esc(video.id)}">
        ${video.thumbnail
          ? `<img src="${this._esc(video.thumbnail)}" alt="${this._esc(video.title)}" loading="lazy">`
          : '<div class="ds-hidden-video-thumb-placeholder"></div>'
        }
        <div class="ds-hidden-video-info">
          <div class="ds-hidden-video-title">${this._esc(video.title || 'Untitled')}</div>
          <div class="ds-hidden-video-meta">
            ${video.level ? `<span class="ds-hidden-level-badge ${levelClass}">${this._esc(video.level)}</span>` : ''}
            ${video.duration ? `<span class="ds-hidden-duration">${this._esc(video.duration)}</span>` : ''}
          </div>
          <button class="ds-unhide-btn" data-video-id="${this._esc(video.id)}">Unhide</button>
        </div>
      </div>
    `;
  },

  _wireSectionEvents(section, videos) {
    // Toggle collapse/expand
    const header = section.querySelector('.ds-hidden-header');
    const body = section.querySelector('.ds-hidden-body');
    const chevron = section.querySelector('.ds-hidden-chevron');

    header.addEventListener('click', () => {
      const collapsed = body.classList.toggle('collapsed');
      chevron.classList.toggle('open', !collapsed);
    });

    // Unhide buttons
    section.addEventListener('click', e => {
      const btn = e.target.closest('.ds-unhide-btn');
      if (!btn) return;
      const videoId = btn.dataset.videoId;
      this._unhideVideo(section, videoId);
    });
  },

  _unhideVideo(section, videoId) {
    chrome.runtime.sendMessage({ type: 'UNHIDE_VIDEO', videoId }, response => {
      if (!response?.ok) return;

      // Remove the card from the grid
      const card = section.querySelector(`.ds-hidden-video-card[data-video-id="${CSS.escape(videoId)}"]`);
      if (card) card.remove();

      // Update count in header
      const grid = section.querySelector('.ds-hidden-grid');
      const remaining = grid ? grid.querySelectorAll('.ds-hidden-video-card').length : 0;
      const titleEl = section.querySelector('.ds-hidden-title');
      if (titleEl) titleEl.textContent = `Hidden videos (${remaining})`;

      // Show empty message if none left
      if (remaining === 0 && grid) {
        grid.replaceWith(Object.assign(document.createElement('p'), {
          className: 'ds-hidden-empty',
          textContent: 'No hidden videos yet.'
        }));
      }

      // Also un-hide the video card on the page if it exists
      const pageCards = document.querySelectorAll(
        '[class*="video-card"], [class*="VideoCard"], [class*="video-item"], [class*="VideoItem"]'
      );
      pageCards.forEach(pageCard => {
        const data = HideVideoUI.extractVideoData(pageCard);
        if (data.id === videoId) {
          pageCard.style.display = '';
          pageCard.classList.remove('ds-hidden-fade');
        }
      });
    });
  },

  // ---- Helpers ----

  _esc(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },
};
