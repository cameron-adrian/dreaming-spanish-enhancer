/**
 * Dreaming Spanish Enhancer - Progress UI
 * Builds the DOM for the inline progress card on the progress page.
 */

const ProgressUI = {
  /** Level colors matching Dreaming Spanish badges */
  levelColors: {
    'Superbeginner': '#0ed4d4',
    'Beginner': '#239fe3',
    'Intermediate': '#ff7f3c',
    'Advanced': '#ff2e65',
  },

  createCard(progressData) {
    const card = document.createElement('div');
    card.className = 'ds-card';

    const categories = Object.keys(progressData).filter(k => !k.startsWith('_'));
    if (categories.length === 0) {
      card.innerHTML = `
        <div class="ds-card-header">
          <h2 class="ds-card-title">Enhanced Statistics</h2>
        </div>
        <div class="ds-card-loading">No progress data found. Watch some videos first!</div>`;
      return card;
    }

    const overall = this.computeOverallStats(progressData);

    const almostDone = progressData._almostDone || { sectionCompleters: [], nearlyFinished: [] };
    const almostDoneHtml = this.buildAlmostDoneTab(almostDone);

    const tabsHtml = `<button class="ds-tab ds-tab-active" data-category="_almostDone">Almost Done!</button>` +
      categories.map(cat =>
        `<button class="ds-tab" data-category="${cat}">${this.formatCategoryName(cat)}</button>`
      ).join('');

    const sectionsHtml = `<div class="ds-tab-content ds-tab-content-active" data-category="_almostDone">${almostDoneHtml}</div>` +
      categories.map(cat => {
        const summary = this.computeCategorySummary(progressData[cat]);
        const remaining = summary.totalLabels - summary.completedLabels;
        return `<div class="ds-tab-content" data-category="${cat}">
        <div class="ds-category-summary">
          <span class="ds-category-summary-text">
            <span>${summary.completedLabels}</span> of ${summary.totalLabels} ${this.formatCategoryPlural(cat)} completed — ${summary.percent}% (${remaining} remaining)
          </span>
          <div class="ds-category-summary-bar">
            <div class="ds-category-summary-fill" style="width: ${summary.percent}%"></div>
          </div>
        </div>
        ${this.buildCategorySection(cat, progressData[cat])}
      </div>`;
      }).join('');

    card.innerHTML = `
      <div class="ds-card-header">
        <h2 class="ds-card-title">Enhanced Statistics</h2>
        <button class="ds-card-refresh" title="Refresh data">&#x21bb;</button>
      </div>
      <div class="ds-card-stats">
        <div class="ds-stat">
          <span class="ds-stat-value">${overall.watchedHours.toFixed(1)}h</span>
          <span class="ds-stat-label">Watched</span>
        </div>
        <div class="ds-stat">
          <span class="ds-stat-value">${overall.totalHours.toFixed(1)}h</span>
          <span class="ds-stat-label">Total</span>
        </div>
        <div class="ds-stat">
          <span class="ds-stat-value">${overall.percent}%</span>
          <span class="ds-stat-label">Complete</span>
        </div>
        <div class="ds-stat">
          <span class="ds-stat-value">${overall.watchedCount}</span>
          <span class="ds-stat-label">Videos</span>
        </div>
      </div>
      <div class="ds-overall-bar-wrap">
        <div class="ds-overall-bar" style="width: ${overall.percent}%"></div>
      </div>
      <div class="ds-tabs">${tabsHtml}</div>
      <div class="ds-controls" style="display:none">
        <label>Sort:</label>
        <select class="ds-sort-select">
          <option value="name">Name</option>
          <option value="percent-desc" selected>% High to Low</option>
          <option value="percent-asc">% Low to High</option>
          <option value="watched-desc">Hours Watched</option>
          <option value="total-desc">Total Hours</option>
          <option value="count-desc">Video Count</option>
        </select>
        <input class="ds-search" type="text" placeholder="Filter..." />
        <label class="ds-hide-completed">
          <input type="checkbox" class="ds-hide-completed-cb" />
          Hide completed
        </label>
      </div>
      <div class="ds-card-body-inner">
        ${sectionsHtml}
      </div>`;

    // Wire up tab switching
    card.querySelectorAll('.ds-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        card.querySelectorAll('.ds-tab').forEach(t => t.classList.remove('ds-tab-active'));
        card.querySelectorAll('.ds-tab-content').forEach(s => s.classList.remove('ds-tab-content-active'));
        tab.classList.add('ds-tab-active');
        card.querySelector(`.ds-tab-content[data-category="${tab.dataset.category}"]`)
          .classList.add('ds-tab-content-active');

        // Hide sort/filter controls on Almost Done tab
        const controls = card.querySelector('.ds-controls');
        if (controls) {
          controls.style.display = tab.dataset.category === '_almostDone' ? 'none' : '';
        }

        if (tab.dataset.category !== '_almostDone') {
          this.applyControls(card, progressData);
        }
      });
    });

    // Wire up sort, search, hide-completed
    card.querySelector('.ds-sort-select').addEventListener('change', () =>
      this.applyControls(card, progressData));
    card.querySelector('.ds-search').addEventListener('input', () =>
      this.applyControls(card, progressData));
    card.querySelector('.ds-hide-completed-cb').addEventListener('change', () =>
      this.applyControls(card, progressData));

    // Wire up Almost Done sub-tabs
    card.querySelectorAll('.ds-ad-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        const parent = btn.closest('.ds-tab-content');
        parent.querySelectorAll('.ds-ad-subtab').forEach(b => b.classList.remove('ds-ad-subtab-active'));
        parent.querySelectorAll('.ds-ad-view').forEach(v => v.classList.remove('ds-ad-view-active'));
        btn.classList.add('ds-ad-subtab-active');
        parent.querySelector(`.ds-ad-view[data-view="${btn.dataset.view}"]`)
          ?.classList.add('ds-ad-view-active');
      });
    });

    // Wire up Nearly Finished limit selector
    const limitSelect = card.querySelector('.ds-ad-limit-select');
    if (limitSelect) {
      limitSelect.addEventListener('change', () => {
        const limit = parseInt(limitSelect.value, 10);
        const items = card.querySelectorAll('.ds-ad-nearly-item');
        items.forEach(item => {
          const idx = parseInt(item.dataset.index, 10);
          item.classList.toggle('ds-ad-nearly-hidden', limit > 0 && idx >= limit);
        });
      });
    }

    return card;
  },

  computeOverallStats(progressData) {
    const userStats = progressData._userStats;
    if (userStats) {
      const levelLabels = progressData.level || {};
      let totalHours = 0, watchedHours = 0;
      for (const stats of Object.values(levelLabels)) {
        totalHours += stats.total;
        watchedHours += stats.watched;
      }
      const percent = totalHours > 0 ? Math.round((watchedHours / totalHours) * 100) : 0;
      return {
        totalHours, watchedHours,
        totalCount: userStats.totalVideos,
        watchedCount: userStats.watchedVideos,
        percent
      };
    }

    const firstCat = Object.keys(progressData).filter(k => !k.startsWith('_'))[0];
    const labels = progressData[firstCat] || {};
    let totalHours = 0, watchedHours = 0, totalCount = 0, watchedCount = 0;
    for (const stats of Object.values(labels)) {
      totalHours += stats.total;
      watchedHours += stats.watched;
      totalCount += stats.count;
      watchedCount += stats.watchedCount;
    }
    const percent = totalHours > 0 ? Math.round((watchedHours / totalHours) * 100) : 0;
    return { totalHours, watchedHours, totalCount, watchedCount, percent };
  },

  computeCategorySummary(labels) {
    const entries = Object.values(labels);
    const totalLabels = entries.length;
    const completedLabels = entries.filter(s => s.total > 0 && s.watched >= s.total).length;
    const percent = totalLabels > 0 ? Math.round((completedLabels / totalLabels) * 100) : 0;
    return { totalLabels, completedLabels, percent };
  },

  buildCategorySection(category, labels) {
    const entries = Object.entries(labels)
      .sort((a, b) => {
        const pctA = a[1].total > 0 ? a[1].watched / a[1].total : 0;
        const pctB = b[1].total > 0 ? b[1].watched / b[1].total : 0;
        return pctB - pctA;
      });

    if (entries.length === 0) {
      return '<p class="ds-empty">No data for this category.</p>';
    }

    return entries.map(([label, stats]) => this.buildProgressRow(label, stats, category)).join('');
  },

  buildProgressRow(label, stats, category) {
    const percent = stats.total > 0 ? Math.round((stats.watched / stats.total) * 100) : 0;
    const isComplete = percent >= 100;
    const barColor = this.getBarColor(percent);

    let labelHtml;
    if (category === 'level' && this.levelColors[label]) {
      const color = this.levelColors[label];
      labelHtml = `<span class="ds-level-badge" style="background: ${color}1a; color: ${color}; border: 1px solid ${color}40;">${this.escapeHtml(label)}</span>`;
    } else {
      labelHtml = `<span class="ds-row-label">${this.escapeHtml(label)}</span>`;
    }

    return `
      <div class="ds-row ${isComplete ? 'ds-row-complete' : ''}" data-label="${this.escapeHtml(label)}" data-percent="${percent}"
           data-watched="${stats.watched}" data-total="${stats.total}" data-count="${stats.count}">
        <div class="ds-row-header">
          ${labelHtml}
          <span class="ds-row-stats">
            ${stats.watched.toFixed(1)}h / ${stats.total.toFixed(1)}h
            <span class="ds-row-videos">(${stats.watchedCount}/${stats.count} videos)</span>
          </span>
        </div>
        <div class="ds-bar-wrap">
          <div class="ds-bar" style="width: ${percent}%; background: ${barColor}"></div>
          <span class="ds-bar-pct">${percent}%</span>
        </div>
      </div>`;
  },

  applyControls(container, progressData) {
    const sortKey = container.querySelector('.ds-sort-select').value;
    const filterText = (container.querySelector('.ds-search').value || '').toLowerCase().trim();
    const hideCompleted = container.querySelector('.ds-hide-completed-cb').checked;

    const activeContent = container.querySelector('.ds-tab-content-active');
    if (!activeContent) return;

    const rows = Array.from(activeContent.querySelectorAll('.ds-row'));

    rows.forEach(row => {
      const label = (row.dataset.label || '').toLowerCase();
      const matchesFilter = !filterText || label.includes(filterText);
      const isComplete = row.classList.contains('ds-row-complete');
      const hidden = !matchesFilter || (hideCompleted && isComplete);
      row.classList.toggle('ds-row-hidden', hidden);
    });

    const sortFn = this.getSortFn(sortKey);
    rows.sort(sortFn).forEach(row => activeContent.appendChild(row));

    // Update summary
    const summaryEl = activeContent.querySelector('.ds-category-summary');
    if (summaryEl) {
      const cat = activeContent.dataset.category;
      const labels = progressData[cat];
      if (labels) {
        const s = this.computeCategorySummary(labels);
        const remaining = s.totalLabels - s.completedLabels;
        summaryEl.querySelector('.ds-category-summary-text').innerHTML =
          `<span>${s.completedLabels}</span> of ${s.totalLabels} ${this.formatCategoryPlural(cat)} completed — ${s.percent}% (${remaining} remaining)`;
      }
    }
  },

  getSortFn(sortKey) {
    switch (sortKey) {
      case 'name':
        return (a, b) => (a.dataset.label || '').localeCompare(b.dataset.label || '');
      case 'percent-desc':
        return (a, b) => Number(b.dataset.percent) - Number(a.dataset.percent);
      case 'percent-asc':
        return (a, b) => Number(a.dataset.percent) - Number(b.dataset.percent);
      case 'watched-desc':
        return (a, b) => Number(b.dataset.watched) - Number(a.dataset.watched);
      case 'total-desc':
        return (a, b) => Number(b.dataset.total) - Number(a.dataset.total);
      case 'count-desc':
        return (a, b) => Number(b.dataset.count) - Number(a.dataset.count);
      default:
        return () => 0;
    }
  },

  getBarColor(percent) {
    if (percent >= 100) return '#28a745';
    if (percent >= 75) return '#ff9301';
    if (percent >= 50) return '#ffb347';
    if (percent >= 25) return '#6354b1';
    return '#8377c1';
  },

  formatCategoryName(name) {
    return name
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, s => s.toUpperCase())
      .trim();
  },

  /** Build a link to a DS video page. Tries slug first, falls back to ID. */
  videoUrl(video) {
    const langPath = (location.pathname.split('/')[1]) || 'spanish';
    const slug = video.slug || video.id;
    return `/${langPath}/video/${slug}`;
  },

  formatCategoryPlural(name) {
    const singular = this.formatCategoryName(name).toLowerCase();
    if (singular === 'series') return 'series';
    if (singular.endsWith('s')) return singular;
    return singular + 's';
  },

  buildAlmostDoneTab(almostDone) {
    const { sectionCompleters = [], nearlyFinished = [] } = almostDone;
    let html = '';

    // Sub-tab toggle between the two views
    html += `<div class="ds-ad-subtabs">
      <button class="ds-ad-subtab ds-ad-subtab-active" data-view="completers">Section Completers${sectionCompleters.length ? ` (${sectionCompleters.length})` : ''}</button>
      <button class="ds-ad-subtab" data-view="nearly">Nearly Finished${nearlyFinished.length ? ` (${nearlyFinished.length})` : ''}</button>
    </div>`;

    // Section Completers view
    html += `<div class="ds-ad-view ds-ad-view-active" data-view="completers">`;
    if (sectionCompleters.length === 0) {
      html += `<p class="ds-empty">No sections are close to completion yet. Keep watching!</p>`;
    } else {
      for (const section of sectionCompleters) {
        const catLabel = this.formatCategoryName(section.category);
        const barColor = this.getBarColor(section.percent);
        html += `
          <div class="ds-ad-section">
            <div class="ds-ad-section-header">
              <div class="ds-ad-section-info">
                <span class="ds-ad-section-label">${this.escapeHtml(section.label)}</span>
                <span class="ds-ad-section-cat">${catLabel}</span>
              </div>
              <span class="ds-ad-section-stats">${section.watchedVideos}/${section.totalVideos} videos — ${section.remaining} to go!</span>
            </div>
            <div class="ds-bar-wrap">
              <div class="ds-bar" style="width: ${section.percent}%; background: ${barColor}"></div>
              <span class="ds-bar-pct">${section.percent}%</span>
            </div>
            <div class="ds-ad-video-list">
              ${section.videos.map(v => `
                <a class="ds-ad-video-item" href="${this.videoUrl(v)}" target="_blank">
                  <span class="ds-ad-video-title">${this.escapeHtml(v.title)}</span>
                  <span class="ds-ad-video-meta">${this.formatDuration(v.duration)}${v.level ? ' · ' + v.level : ''}</span>
                </a>
              `).join('')}
            </div>
          </div>`;
      }
    }
    html += `</div>`;

    // Nearly Finished view
    html += `<div class="ds-ad-view" data-view="nearly">`;
    if (nearlyFinished.length === 0) {
      html += `<p class="ds-empty">No partially-watched videos found. The API may not expose in-video progress data.</p>`;
    } else {
      html += `<div class="ds-ad-limit-controls">
        <label>Show:</label>
        <select class="ds-ad-limit-select">
          <option value="10" selected>Top 10</option>
          <option value="20">Top 20</option>
          <option value="50">Top 50</option>
          <option value="0">All (${nearlyFinished.length})</option>
        </select>
      </div>`;
      html += `<div class="ds-ad-nearly-list">`;
      for (let i = 0; i < nearlyFinished.length; i++) {
        const v = nearlyFinished[i];
        const barColor = this.getBarColor(v.progress);
        const hidden = i >= 10 ? ' ds-ad-nearly-hidden' : '';
        html += `
          <div class="ds-ad-nearly-item${hidden}" data-index="${i}">
            <a class="ds-ad-nearly-header" href="${this.videoUrl(v)}" target="_blank">
              <span class="ds-ad-video-title">${this.escapeHtml(v.title)}</span>
              <span class="ds-ad-video-meta">${this.formatDuration(v.remainingSeconds)} left${v.guide ? ' · ' + this.escapeHtml(v.guide) : ''}</span>
            </a>
            <div class="ds-bar-wrap">
              <div class="ds-bar" style="width: ${v.progress}%; background: ${barColor}"></div>
              <span class="ds-bar-pct">${v.progress}%</span>
            </div>
          </div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;

    return html;
  },

  formatDuration(seconds) {
    if (!seconds || seconds <= 0) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  },

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
