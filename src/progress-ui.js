/**
 * Dreaming Spanish Enhancer - Progress UI
 * Builds the DOM for the slide-out progress panel.
 */

const ProgressUI = {
  createPanel(progressData) {
    const panel = document.createElement('div');
    panel.className = 'ds-panel';

    const categories = Object.keys(progressData);
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

    // Compute overall stats
    const overall = this.computeOverallStats(progressData);

    // Build tabs for each category
    const tabsHtml = categories.map((cat, i) =>
      `<button class="ds-tab ${i === 0 ? 'ds-tab-active' : ''}" data-category="${cat}">${this.formatCategoryName(cat)}</button>`
    ).join('');

    // Build content sections for each category
    const sectionsHtml = categories.map((cat, i) =>
      `<div class="ds-tab-content ${i === 0 ? 'ds-tab-content-active' : ''}" data-category="${cat}">
        ${this.buildCategorySection(cat, progressData[cat])}
      </div>`
    ).join('');

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
      <div class="ds-panel-body">
        <div class="ds-sort-controls">
          <label>Sort by:</label>
          <select class="ds-sort-select">
            <option value="name">Name</option>
            <option value="percent-desc" selected>% Complete (High → Low)</option>
            <option value="percent-asc">% Complete (Low → High)</option>
            <option value="watched-desc">Hours Watched (High → Low)</option>
            <option value="total-desc">Total Hours (High → Low)</option>
            <option value="count-desc">Video Count (High → Low)</option>
          </select>
          <input class="ds-search" type="text" placeholder="Filter..." />
        </div>
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
      });
    });

    // Wire up sorting
    const sortSelect = panel.querySelector('.ds-sort-select');
    sortSelect.addEventListener('change', () => {
      this.applySortAndFilter(panel, progressData, sortSelect.value,
        panel.querySelector('.ds-search').value);
    });

    // Wire up search/filter
    const searchInput = panel.querySelector('.ds-search');
    searchInput.addEventListener('input', () => {
      this.applySortAndFilter(panel, progressData, sortSelect.value, searchInput.value);
    });

    return panel;
  },

  computeOverallStats(progressData) {
    // Use the first category to avoid double-counting
    const firstCat = Object.keys(progressData)[0];
    const labels = progressData[firstCat];
    let totalHours = 0, watchedHours = 0, totalCount = 0, watchedCount = 0;

    // Since videos can appear in multiple labels, we approximate
    // by summing and noting it's per-category
    for (const stats of Object.values(labels)) {
      totalHours += stats.total;
      watchedHours += stats.watched;
      totalCount += stats.count;
      watchedCount += stats.watchedCount;
    }

    const percent = totalHours > 0 ? Math.round((watchedHours / totalHours) * 100) : 0;
    return { totalHours, watchedHours, totalCount, watchedCount, percent };
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

    return entries.map(([label, stats]) => this.buildProgressRow(label, stats)).join('');
  },

  buildProgressRow(label, stats) {
    const percent = stats.total > 0 ? Math.round((stats.watched / stats.total) * 100) : 0;
    const barColor = this.getBarColor(percent);

    return `
      <div class="ds-row" data-label="${this.escapeHtml(label)}" data-percent="${percent}"
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

  applySortAndFilter(panel, progressData, sortKey, filterText) {
    const filter = (filterText || '').toLowerCase().trim();
    const activeContent = panel.querySelector('.ds-tab-content-active');
    if (!activeContent) return;

    const rows = Array.from(activeContent.querySelectorAll('.ds-row'));

    // Filter
    rows.forEach(row => {
      const label = (row.dataset.label || '').toLowerCase();
      row.style.display = (!filter || label.includes(filter)) ? '' : 'none';
    });

    // Sort
    const sortFn = this.getSortFn(sortKey);
    const sorted = rows.sort(sortFn);
    sorted.forEach(row => activeContent.appendChild(row));
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
    if (percent >= 100) return '#4CAF50';
    if (percent >= 75) return '#8BC34A';
    if (percent >= 50) return '#FFC107';
    if (percent >= 25) return '#FF9800';
    return '#FF5722';
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
