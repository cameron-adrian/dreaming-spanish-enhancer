/**
 * Dreaming Spanish Enhancer - Progress UI
 * Builds the DOM for the slide-out progress panel.
 */

const ProgressUI = {
  /** Detect whether DS site is in dark mode */
  isDarkMode() {
    const root = document.documentElement;
    const colorScheme = getComputedStyle(root).getPropertyValue('color-scheme').trim();
    if (colorScheme === 'dark') return true;
    if (colorScheme === 'light') return false;
    // Fallback: check background color luminance
    const bg = getComputedStyle(root).getPropertyValue('--darkBackground');
    if (bg) return true;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  },

  /** Level colors matching Dreaming Spanish badges */
  levelColors: {
    'Superbeginner': '#28a745',
    'Beginner': '#6354b1',
    'Intermediate': '#e83e8c',
    'Advanced': '#fd7e14',
  },

  createPanel(progressData) {
    const panel = document.createElement('div');
    panel.className = 'ds-panel';
    if (this.isDarkMode()) panel.classList.add('ds-dark');

    const categories = Object.keys(progressData).filter(k => k !== '_userStats');
    if (categories.length === 0) {
      panel.innerHTML = `
        <div class="ds-panel-header">
          <h2>Dreaming Spanish Enhancer</h2>
          <div class="ds-panel-actions">
            <button class="ds-panel-refresh" title="Refresh data">&#x21bb;</button>
            <button class="ds-panel-close" title="Close">&times;</button>
          </div>
        </div>
        <div class="ds-panel-body">
          <p class="ds-empty">No progress data found. Watch some videos first!</p>
        </div>`;
      return panel;
    }

    const overall = this.computeOverallStats(progressData);

    const tabsHtml = categories.map((cat, i) =>
      `<button class="ds-tab ${i === 0 ? 'ds-tab-active' : ''}" data-category="${cat}">${this.formatCategoryName(cat)}</button>`
    ).join('');

    const sectionsHtml = categories.map((cat, i) => {
      const summary = this.computeCategorySummary(progressData[cat]);
      return `<div class="ds-tab-content ${i === 0 ? 'ds-tab-content-active' : ''}" data-category="${cat}">
        <div class="ds-category-summary">
          <span class="ds-category-summary-text">
            <span>${summary.completedLabels}</span> of ${summary.totalLabels} ${this.formatCategoryName(cat).toLowerCase()} completed
          </span>
          <div class="ds-category-summary-bar">
            <div class="ds-category-summary-fill" style="width: ${summary.percent}%"></div>
          </div>
        </div>
        ${this.buildCategorySection(cat, progressData[cat])}
      </div>`;
    }).join('');

    panel.innerHTML = `
      <div class="ds-panel-header">
        <h2>Progress Tracker</h2>
        <div class="ds-panel-actions">
          <button class="ds-panel-refresh" title="Refresh data">&#x21bb;</button>
          <button class="ds-panel-close" title="Close">&times;</button>
        </div>
      </div>
      <div class="ds-overall">
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
      <div class="ds-controls">
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
          Hide 100%
        </label>
      </div>
      <div class="ds-panel-body">
        ${sectionsHtml}
      </div>`;

    // Wire up tab switching
    panel.querySelectorAll('.ds-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.ds-tab').forEach(t => t.classList.remove('ds-tab-active'));
        panel.querySelectorAll('.ds-tab-content').forEach(s => s.classList.remove('ds-tab-content-active'));
        tab.classList.add('ds-tab-active');
        panel.querySelector(`.ds-tab-content[data-category="${tab.dataset.category}"]`)
          .classList.add('ds-tab-content-active');
        this.applyControls(panel, progressData);
      });
    });

    // Wire up sorting
    const sortSelect = panel.querySelector('.ds-sort-select');
    sortSelect.addEventListener('change', () => this.applyControls(panel, progressData));

    // Wire up search/filter
    const searchInput = panel.querySelector('.ds-search');
    searchInput.addEventListener('input', () => this.applyControls(panel, progressData));

    // Wire up hide completed
    const hideCb = panel.querySelector('.ds-hide-completed-cb');
    hideCb.addEventListener('change', () => this.applyControls(panel, progressData));

    return panel;
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
        totalHours,
        watchedHours,
        totalCount: userStats.totalVideos,
        watchedCount: userStats.watchedVideos,
        percent
      };
    }

    const firstCat = Object.keys(progressData).filter(k => k !== '_userStats')[0];
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
    const barColor = this.getBarColor(percent, label, category);

    return `
      <div class="ds-row ${isComplete ? 'ds-row-complete' : ''}" data-label="${this.escapeHtml(label)}" data-percent="${percent}"
           data-watched="${stats.watched}" data-total="${stats.total}" data-count="${stats.count}">
        <div class="ds-row-header">
          <span class="ds-row-label">${this.escapeHtml(label)}</span>
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

  applyControls(panel, progressData) {
    const sortKey = panel.querySelector('.ds-sort-select').value;
    const filterText = (panel.querySelector('.ds-search').value || '').toLowerCase().trim();
    const hideCompleted = panel.querySelector('.ds-hide-completed-cb').checked;

    const activeContent = panel.querySelector('.ds-tab-content-active');
    if (!activeContent) return;

    const rows = Array.from(activeContent.querySelectorAll('.ds-row'));

    // Apply filter + hide completed
    let visibleCount = 0;
    let totalCount = rows.length;
    rows.forEach(row => {
      const label = (row.dataset.label || '').toLowerCase();
      const matchesFilter = !filterText || label.includes(filterText);
      const isComplete = row.classList.contains('ds-row-complete');
      const hidden = !matchesFilter || (hideCompleted && isComplete);
      row.classList.toggle('ds-row-hidden', hidden);
      if (!hidden) visibleCount++;
    });

    // Sort visible rows
    const sortFn = this.getSortFn(sortKey);
    rows.sort(sortFn).forEach(row => activeContent.appendChild(row));

    // Update summary to reflect filter
    const summary = activeContent.querySelector('.ds-category-summary');
    if (summary && hideCompleted) {
      const completedCount = rows.filter(r => r.classList.contains('ds-row-complete')).length;
      const remaining = totalCount - completedCount;
      summary.querySelector('.ds-category-summary-text').innerHTML =
        `<span>${completedCount}</span> of ${totalCount} completed (${remaining} remaining)`;
    } else if (summary) {
      const cat = activeContent.dataset.category;
      const labels = progressData[cat];
      if (labels) {
        const s = this.computeCategorySummary(labels);
        summary.querySelector('.ds-category-summary-text').innerHTML =
          `<span>${s.completedLabels}</span> of ${s.totalLabels} ${this.formatCategoryName(cat).toLowerCase()} completed`;
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

  getBarColor(percent, label, category) {
    // Use DS level colors for level category
    if (category === 'level' && this.levelColors[label]) {
      return this.levelColors[label];
    }
    // Default: orange gradient based on DS primary
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

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
};
