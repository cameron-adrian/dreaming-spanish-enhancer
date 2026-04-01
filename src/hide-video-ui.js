/**
 * Dreaming Spanish Enhancer - Hide Video UI Module
 * Injects a "Hide video" option into the DS 3-dots menu and renders
 * a DS-carousel-style "Hidden videos" row on the /library page.
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
   * Extract video metadata from a .ds-catalog-video-card element.
   * The video ID is reliably extracted from the CloudFront thumbnail URL.
   */
  extractVideoData(cardEl) {
    if (!cardEl) return {};

    // thumbnail & ID — the image src contains the video ID as the filename
    // e.g. https://d36f3pr6g3yfev.cloudfront.net/5e4d1228aac87f3820954ce0.jpg
    const img = cardEl.querySelector('.ds-image__image, .ds-video-thumbnail__image, img');
    const thumbnail = img?.src || img?.dataset?.src || img?.dataset?.lazySrc
      || img?.dataset?.original || img?.getAttribute('data-src') || '';
    const idMatch = thumbnail.match(/\/([a-f0-9]{24})\.(?:jpg|jpeg|png|webp)/i);
    let id = idMatch ? idMatch[1] : '';

    // title
    const titleEl = cardEl.querySelector('.ds-catalog-video-card__title') ||
                    cardEl.querySelector('[class*="title" i]') ||
                    cardEl.querySelector('h3, h2, h4, p');
    const title = (titleEl?.textContent || '').trim().replace(/\s+/g, ' ');

    // duration — inside the watched-duration badge
    const durationEl = cardEl.querySelector('.ds-video-thumbnail__badge--watched-duration span') ||
                       cardEl.querySelector('[class*="duration" i] span') ||
                       cardEl.querySelector('[class*="duration" i]');
    const duration = (durationEl?.textContent || '').trim();

    // level — from badge class name like ds-badge--level-intermediate-special
    const levelBadgeEl = cardEl.querySelector('[class*="badge--level-"]');
    let level = '';
    if (levelBadgeEl) {
      const m = levelBadgeEl.className.match(/badge--level-([a-z]+)/);
      if (m) level = m[1].replace('special', '').replace(/-$/, '');
    }

    // slug — best effort from any link href; also try extracting hex ID from the URL
    const link = cardEl.querySelector('a[href*="/videos/"], a[href*="/watch/"], a[href]');
    const href = link?.getAttribute('href') || '';
    const slugMatch = href.match(/\/(?:videos|watch)\/([^/?#]+)/);
    const slug = slugMatch ? slugMatch[1] : id;

    // If thumbnail didn't yield an ID, try the video page URL
    if (!id) {
      const urlIdMatch = href.match(/([a-f0-9]{24})/i);
      if (urlIdMatch) id = urlIdMatch[1];
    }

    // Last resort: use the slug as the unique key
    const effectiveId = id || slug;

    return { id: effectiveId, slug, title, thumbnail, duration, level };
  },

  // ---- Menu Injection ----

  /**
   * Inject a "Hide video" option into the DS native dropdown menu.
   * Matches the DS menu item structure exactly:
   *   <div class="ds-video-options__item">
   *     <svg .../>
   *     <p class="ds-video-options__item-label">Hide video</p>
   *   </div>
   */
  injectMenuOption(menuEl, videoData, onHide) {
    if (menuEl.querySelector('.ds-hide-menu-item')) return;

    // Detect the structure of existing menu items to match styling
    const existingItem = menuEl.querySelector('.ds-video-options__item') || menuEl.children[0];
    const tag = existingItem?.tagName?.toLowerCase() || 'div';
    const item = document.createElement(tag);

    // Copy classes from existing items so our item matches visually
    if (existingItem?.className) {
      item.className = existingItem.className + ' ds-hide-menu-item';
    } else {
      item.className = 'ds-video-options__item ds-hide-menu-item';
    }

    // Match label element tag and class from existing items
    const existingLabel = existingItem?.querySelector('p, span');
    const labelTag = existingLabel?.tagName?.toLowerCase() || 'p';
    const labelClass = existingLabel?.className || 'ds-video-options__item-label';

    // Match icon sizing from existing SVG icons
    const existingSvg = existingItem?.querySelector('svg');
    let svgSizeStyle = '';
    if (existingSvg) {
      const svgClass = existingSvg.getAttribute('class') || '';
      const rect = existingSvg.getBoundingClientRect();
      if (rect.width > 0) svgSizeStyle = `width:${rect.width}px;height:${rect.height}px;`;
      item.querySelector('svg')?.setAttribute('class', svgClass + ' ds-hide-menu-item__icon');
    }

    item.innerHTML = `
      <svg class="${existingSvg?.getAttribute('class') || 'ds-video-options__item-icon'} ds-hide-menu-item__icon"
           viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
           style="display:inline-block;${svgSizeStyle}">
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8
                 a18.45 18.45 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8
                 a18.5 18.5 0 0 1-2.16 3.19"/>
        <line x1="1" y1="1" x2="23" y2="23"/>
      </svg>
      <${labelTag} class="${labelClass}">Hide video</${labelTag}>
    `;

    item.addEventListener('click', e => {
      e.stopPropagation();
      onHide();
    });

    menuEl.appendChild(item);
  },

  // ---- Library Section (DS Carousel Style) ----

  /**
   * Build and return a DS-carousel-style "Hidden videos" section
   * that visually matches the Downloads / My list rows on /library.
   */
  createSection(videos, isDark) {
    const wrap = document.createElement('div');
    wrap.id = 'ds-hidden-section';
    wrap.className = 'ds-downloads';

    wrap.innerHTML = this._buildCarouselHtml(videos);
    this._wireSectionEvents(wrap, videos);
    return wrap;
  },

  _buildCarouselHtml(videos) {
    return `
      <div class="ds-carousel ds-hidden-carousel">
        <div class="ds-carousel__header">
          <div class="ds-carousel__header-group">
            <div class="ds-carousel__header-title-group">
              <svg class="ds-carousel__icon" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round"
                   stroke-linejoin="round" style="display:inline-block;width:20px;height:20px">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8
                         a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8
                         a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              <h1 class="ds-carousel__title ds-text-capitalize-first ds-hidden-title">
                Hidden videos (${videos.length})
              </h1>
            </div>
            <button class="btn ds-button ds-button--primary-invert ds-button--compress ds-hidden-toggle-btn">
              ${videos.length === 0 ? 'Show' : 'Show'}
              <svg class="ds-button__icon ds-button__icon--sm ds-button__icon--right ds-hidden-chevron"
                   viewBox="0 0 1024 1024" style="display:inline-block;stroke:currentcolor;fill:currentcolor">
                <polyline points="256 384 512 640 768 384" stroke-width="120"
                          stroke-linecap="round" stroke-linejoin="round" fill="none"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="ds-carousel__carousel ds-hidden-body collapsed">
          ${videos.length === 0
            ? '<p class="ds-hidden-empty" style="padding:16px 0">No hidden videos yet.</p>'
            : videos.map(v => this._buildSlideHtml(v)).join('')
          }
        </div>
      </div>
    `;
  },

  _buildSlideHtml(video) {
    const levelClass = video.level
      ? `ds-badge--level-${this._esc(video.level)}-special`
      : '';
    const levelLabel = video.level
      ? `<div class="ds-badge ds-badge--sm ${levelClass}">
           <span class="ds-text-capitalize-first">${this._esc(video.level)}</span>
         </div>`
      : '';

    return `
      <div class="ds-carousel__slide ds-downloads__slide ds-hidden-slide"
           data-video-id="${this._esc(video.id)}">
        <div class="ds-catalog-video-card">
          <div class="ds-video-thumbnail">
            <div class="ds-image">
              ${video.thumbnail
                ? `<img class="ds-image__image ds-video-thumbnail__image"
                        src="${this._esc(video.thumbnail)}"
                        alt="thumbnail" loading="lazy">`
                : '<div class="ds-image__default"></div>'
              }
            </div>
            ${video.duration
              ? `<div class="ds-badge ds-badge--sm ds-badge--gray-80
                            ds-video-thumbnail__badge ds-video-thumbnail__badge--watched-duration">
                   <div class="ds-video-thumbnail__badge-content">
                     <span>${this._esc(video.duration)}</span>
                   </div>
                 </div>`
              : ''
            }
          </div>
          <div class="ds-catalog-video-card__content">
            <div class="ds-catalog-video-card__header">
              <p class="ds-catalog-video-card__title">${this._esc(video.title || 'Untitled')}</p>
            </div>
            <div class="ds-catalog-video-card__footer">
              <div class="ds-catalog-video-card__badges">
                ${levelLabel}
              </div>
              <button class="ds-unhide-btn" data-video-id="${this._esc(video.id)}">
                Unhide
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  _wireSectionEvents(wrap, videos) {
    const btn = wrap.querySelector('.ds-hidden-toggle-btn');
    const body = wrap.querySelector('.ds-hidden-body');
    const chevron = wrap.querySelector('.ds-hidden-chevron');

    btn.addEventListener('click', () => {
      const collapsed = body.classList.toggle('collapsed');
      chevron.style.transform = collapsed ? '' : 'rotate(180deg)';
      btn.querySelector('.ds-hidden-chevron').style.transform = collapsed ? '' : 'rotate(180deg)';
    });

    // Unhide via event delegation
    wrap.addEventListener('click', e => {
      const unhideBtn = e.target.closest('.ds-unhide-btn');
      if (!unhideBtn) return;
      this._unhideVideo(wrap, unhideBtn.dataset.videoId);
    });
  },

  _unhideVideo(wrap, videoId) {
    chrome.runtime.sendMessage({ type: 'UNHIDE_VIDEO', videoId }, response => {
      if (!response?.ok) return;

      // Remove the slide from the carousel
      const slide = wrap.querySelector(`.ds-hidden-slide[data-video-id="${CSS.escape(videoId)}"]`);
      if (slide) slide.remove();

      // Update count in title
      const remaining = wrap.querySelectorAll('.ds-hidden-slide').length;
      const titleEl = wrap.querySelector('.ds-hidden-title');
      if (titleEl) titleEl.textContent = `Hidden videos (${remaining})`;

      // Show empty message if none left
      if (remaining === 0) {
        const body = wrap.querySelector('.ds-hidden-body');
        if (body) {
          body.innerHTML = '<p class="ds-hidden-empty" style="padding:16px 0">No hidden videos yet.</p>';
        }
      }

      // Restore the card on the current page if it's visible
      document.querySelectorAll('.ds-catalog-video-card').forEach(card => {
        if (card.closest('#ds-hidden-section')) return;
        const data = HideVideoUI.extractVideoData(card);
        if (data.id === videoId) {
          card.style.display = '';
          card.classList.remove('ds-hidden-fade');
        }
      });
    });
  },

  // ---- Helpers ----

  _esc(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },
};
