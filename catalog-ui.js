'use strict';

/**
 * UI каталога: вкладки, рулетка, коллекция и статистика.
 * Чистая логика (фильтры, случайный выбор, коллекция) живёт в lib/catalog-core.js.
 */
(function () {
  const Core = window.DimHookahCore;
  if (!Core) return;

  const SPIN_MS = 5000;
  const REEL_CARDS = 52;
  const WINNER_INDEX = 44;
  const IDLE_CARDS = 24;

  const KEYS = {
    collection: 'hookah_collection_v1',
    fast: 'hookah_roulette_fast',
    spins: 'hookah_roulette_spins'
  };

  const TABS = ['home', 'catalog', 'roulette', 'collection'];
  const numberFormatter = new Intl.NumberFormat('ru-RU');

  const state = {
    catalog: [],
    bySlug: new Map(),
    stats: null,
    loading: true,
    ready: false,
    error: null,
    activeTab: 'home',
    filters: {
      brand: 'all',
      strength: 'all',
      category: 'all',
      rating: 'all',
      photoOnly: false,
      limitedOnly: false,
      includeDiscontinued: false
    },
    collection: [],
    collectionFilter: 'all',
    collectionSearch: '',
    fast: false,
    spinCount: 0,
    running: false,
    winner: null,
    winnerIndex: WINNER_INDEX,
    spinTimer: null
  };

  let el = {};
  let initialized = false;
  let filteredKey = null;
  let filteredItems = [];
  let resizeTimer = null;
  let notifyTimer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function cacheElements() {
    el = {
      panels: [...document.querySelectorAll('.tab-panel')],
      navTabs: [...document.querySelectorAll('.nav-tab')],
      nav: byId('main-nav'),
      headerStatus: byId('header-catalog-status'),
      headerLabel: byId('header-catalog-label'),
      rouletteBrand: byId('roulette-brand'),
      rouletteStrength: byId('roulette-strength'),
      rouletteCategory: byId('roulette-category'),
      rouletteRating: byId('roulette-rating'),
      roulettePhoto: byId('roulette-photo'),
      rouletteLimited: byId('roulette-limited'),
      rouletteDiscontinued: byId('roulette-discontinued'),
      rouletteFast: byId('roulette-fast'),
      rouletteSpin: byId('roulette-spin'),
      rouletteAvailable: byId('roulette-available'),
      rouletteStatus: byId('roulette-status'),
      rouletteWindow: byId('roulette-window'),
      rouletteTrack: byId('roulette-track'),
      rouletteEmpty: byId('roulette-empty'),
      rouletteResult: byId('roulette-result'),
      collectionList: byId('collection-list'),
      collectionEmpty: byId('collection-empty'),
      collectionSearch: byId('collection-search'),
      collectionPill: byId('collection-count-pill'),
      collectionAll: byId('collection-count-all'),
      collectionWish: byId('collection-count-wish'),
      collectionTried: byId('collection-count-tried'),
      clearUserStats: byId('clear-user-stats'),
      userSpins: byId('user-spins'),
      userCollection: byId('user-collection'),
      userTried: byId('user-tried'),
      footerCatalogCount: byId('footer-catalog-count'),
      toast: byId('toast-notification')
    };
  }

  function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? numberFormatter.format(number) : '—';
  }

  function plural(value, one, few, many) {
    const number = Math.abs(Number(value)) % 100;
    const last = number % 10;
    if (number > 10 && number < 20) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
  }

  function countLabel(value) {
    return `${formatNumber(value)} ${plural(value, 'вкус', 'вкуса', 'вкусов')}`;
  }

  function brandLabel(value) {
    return `${formatNumber(value)} ${plural(value, 'бренд', 'бренда', 'брендов')}`;
  }

  function readStorage(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (error) {
      return false;
    }
  }

  function readJson(key, fallback) {
    const raw = readStorage(key);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return fallback;
    }
  }

  function notify(message) {
    if (typeof window.showBannerToast === 'function') {
      window.showBannerToast(message);
      return;
    }
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.classList.remove('hidden');
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => el.toast.classList.add('hidden'), 3200);
  }

  function randomUnit() {
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        const value = new Uint32Array(1);
        window.crypto.getRandomValues(value);
        return value[0] / 4294967296;
      }
    } catch (error) {
      // fallback ниже
    }
    return Math.random();
  }

  function loadPreferences() {
    state.collection = Core.normalizeCollection(readJson(KEYS.collection, []));
    state.fast = readStorage(KEYS.fast) === '1';
    state.spinCount = Math.max(0, Number(readStorage(KEYS.spins)) || 0);
    if (el.rouletteFast) el.rouletteFast.checked = state.fast;
  }

  function saveCollection() {
    return writeStorage(KEYS.collection, JSON.stringify(state.collection));
  }

  function saveFast(value) {
    return writeStorage(KEYS.fast, value ? '1' : '0');
  }

  function saveSpins() {
    return writeStorage(KEYS.spins, String(state.spinCount));
  }

  function isInCollection(slug) {
    return state.collection.some((entry) => entry.slug === slug);
  }

  function getCollectionEntry(slug) {
    return state.collection.find((entry) => entry.slug === slug) || null;
  }

  function normalizeHistoryText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[^a-zа-я0-9]+/gi, '');
  }

  function isInHistory(item) {
    const history = window.DimHookahHistory;
    if (!history || !Array.isArray(history.sessions) || !item) return false;
    const brand = normalizeHistoryText(item.brand);
    const names = [item.name, item.alt_name]
      .map(normalizeHistoryText)
      .filter(Boolean);
    if (!brand || names.length === 0) return false;
    return history.sessions.some((session) => (
      Array.isArray(session.mix) && session.mix.some((mixItem) => (
        normalizeHistoryText(mixItem.brand) === brand &&
        names.includes(normalizeHistoryText(mixItem.flavor))
      ))
    ));
  }

  function getFilteredItems() {
    const key = JSON.stringify(state.filters);
    if (key === filteredKey) return filteredItems;
    filteredKey = key;
    filteredItems = Core.filterItems(state.catalog, state.filters);
    return filteredItems;
  }

  function syncFiltersFromControls() {
    state.filters = {
      brand: el.rouletteBrand ? el.rouletteBrand.value : 'all',
      strength: el.rouletteStrength ? el.rouletteStrength.value : 'all',
      category: el.rouletteCategory ? el.rouletteCategory.value : 'all',
      rating: el.rouletteRating ? el.rouletteRating.value : 'all',
      photoOnly: Boolean(el.roulettePhoto && el.roulettePhoto.checked),
      limitedOnly: Boolean(el.rouletteLimited && el.rouletteLimited.checked),
      includeDiscontinued: Boolean(el.rouletteDiscontinued && el.rouletteDiscontinued.checked)
    };
    filteredKey = null;
  }

  function setSelectValue(select, value) {
    if (!select) return;
    const exists = [...select.options].some((option) => option.value === value);
    select.value = exists ? value : 'all';
  }

  function initTabs() {
    const hash = window.location.hash.replace(/^#/, '');
    const initial = TABS.includes(hash) ? hash : 'home';
    showTab(initial, { updateHash: false, scroll: false });

    el.navTabs.forEach((tab) => {
      tab.addEventListener('click', () => showTab(tab.dataset.tab));
    });

    document.addEventListener('click', (event) => {
      const opener = event.target.closest('[data-open-tab]');
      if (!opener) return;
      event.preventDefault();
      showTab(opener.dataset.openTab);
    });

    window.addEventListener('hashchange', () => {
      const next = window.location.hash.replace(/^#/, '');
      if (TABS.includes(next) && next !== state.activeTab) {
        showTab(next, { updateHash: false });
      }
    });

    if (el.nav) {
      el.nav.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const tabs = el.navTabs;
        const current = tabs.indexOf(document.activeElement);
        let next = current;
        if (event.key === 'ArrowLeft') next = current <= 0 ? tabs.length - 1 : current - 1;
        if (event.key === 'ArrowRight') next = current >= tabs.length - 1 ? 0 : current + 1;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        if (tabs[next]) {
          tabs[next].focus();
          showTab(tabs[next].dataset.tab);
        }
      });
    }
  }

  function showTab(tab, options) {
    const target = TABS.includes(tab) ? tab : 'home';
    const settings = options || {};
    state.activeTab = target;

    for (const panel of el.panels) {
      const active = panel.dataset.panel === target;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    }

    for (const button of el.navTabs) {
      const active = button.dataset.tab === target;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
      button.tabIndex = active ? 0 : -1;
    }

    if (settings.updateHash !== false) {
      try {
        history.replaceState(null, '', `#${target}`);
      } catch (error) {
        // file:// и некоторые WebView могут запрещать replaceState
      }
    }

    if (target === 'roulette' && state.ready) {
      if (!el.rouletteTrack.children.length) renderIdleReel();
      renderCollection();
    }

    if (settings.scroll !== false) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function facetLabel(dimension, value) {
    if (dimension === 'strength' && value === Core.NO_STRENGTH) return 'Без крепости';
    if (dimension === 'category' && value === Core.NO_CATEGORY) return 'Без направления';
    if (dimension === 'rating') return `От ${Number(value).toFixed(1)}`;
    return value;
  }

  function fillFacetSelect(select, values, allLabel, dimension) {
    if (!select) return;
    const previous = select.value;
    const rows = values.map((value) => ({ value, label: facetLabel(dimension, value) }));
    if (dimension === 'rating') {
      rows.sort((a, b) => Number(a.value) - Number(b.value));
    } else {
      rows.sort((a, b) => a.label.localeCompare(b.label, 'ru'));
    }

    const fragment = document.createDocumentFragment();
    fragment.append(new Option(allLabel, 'all'));
    for (const row of rows) fragment.append(new Option(row.label, row.value));
    select.replaceChildren(fragment);

    const exists = [...select.options].some((option) => option.value === previous);
    select.value = exists ? previous : 'all';

    const field = select.closest('.field');
    if (field) field.hidden = rows.length === 0;
  }

  function updateHeaderStatus() {
    if (!el.headerLabel) return;
    if (state.loading) {
      el.headerLabel.textContent = 'Загрузка…';
    } else if (state.error) {
      el.headerLabel.textContent = 'Каталог недоступен';
    } else {
      el.headerLabel.textContent = countLabel(state.catalog.length);
    }
    if (el.headerStatus) {
      el.headerStatus.classList.toggle('is-loading', state.loading);
      el.headerStatus.classList.toggle('is-error', Boolean(state.error));
    }
    if (el.footerCatalogCount) {
      el.footerCatalogCount.textContent = state.ready && state.stats
        ? `${countLabel(state.stats.total)} · ${brandLabel(state.stats.brands)}`
        : state.error
          ? 'Каталог недоступен'
          : 'Локальный каталог';
    }
  }

  /**
   * Пересобирает варианты всех фильтров под текущий запрос:
   * у MUSTHAVE не появится направление, которого у бренда нет.
   */
  function updateFacetedFilters(priority) {
    if (!state.ready) return;

    syncFiltersFromControls();
    const resolved = Core.resolveFilters(state.catalog, state.filters, priority);
    state.filters = { ...state.filters, ...resolved };
    filteredKey = null;

    const facets = [
      {
        dimension: 'brand',
        select: el.rouletteBrand,
        allLabel: 'Все бренды'
      },
      {
        dimension: 'strength',
        select: el.rouletteStrength,
        allLabel: 'Любая крепость'
      },
      {
        dimension: 'category',
        select: el.rouletteCategory,
        allLabel: 'Любое направление'
      },
      {
        dimension: 'rating',
        select: el.rouletteRating,
        allLabel: 'Любой рейтинг'
      }
    ];

    for (const facet of facets) {
      const values = Core.getFacetOptions(state.catalog, state.filters, facet.dimension);
      fillFacetSelect(facet.select, values, facet.allLabel, facet.dimension);
    }

    setSelectValue(el.rouletteBrand, state.filters.brand);
    setSelectValue(el.rouletteStrength, state.filters.strength);
    setSelectValue(el.rouletteCategory, state.filters.category);
    setSelectValue(el.rouletteRating, state.filters.rating);

    state.filters = {
      ...state.filters,
      brand: el.rouletteBrand ? el.rouletteBrand.value : 'all',
      strength: el.rouletteStrength ? el.rouletteStrength.value : 'all',
      category: el.rouletteCategory ? el.rouletteCategory.value : 'all',
      rating: el.rouletteRating ? el.rouletteRating.value : 'all'
    };
    filteredKey = null;
  }

  function updateUserStats() {
    const stats = Core.collectionStats(state.collection);
    if (el.userSpins) el.userSpins.textContent = formatNumber(state.spinCount);
    if (el.userCollection) el.userCollection.textContent = formatNumber(stats.total);
    if (el.userTried) el.userTried.textContent = formatNumber(stats.tried);
    if (el.collectionPill) el.collectionPill.textContent = countLabel(stats.total);
    if (el.collectionAll) el.collectionAll.textContent = formatNumber(stats.total);
    if (el.collectionWish) el.collectionWish.textContent = formatNumber(stats.wish);
    if (el.collectionTried) el.collectionTried.textContent = formatNumber(stats.tried);
  }

  async function clearActionStats() {
    const confirmed = typeof window.showIosConfirm === 'function'
      ? await window.showIosConfirm(
          'Очистить действия?',
          'Будут сброшены вращения рулетки, коллекция и отметки «Попробовал». Это действие нельзя отменить.',
          'Очистить',
          true
        )
      : window.confirm('Сбросить вращения, коллекцию и отметки «Попробовал»?');
    if (!confirmed) return;

    state.collection = [];
    state.spinCount = 0;
    state.collectionFilter = 'all';
    state.collectionSearch = '';
    saveCollection();
    saveSpins();
    if (el.collectionSearch) el.collectionSearch.value = '';
    renderCollection();
    updateUserStats();
    if (state.winner && el.rouletteResult && !el.rouletteResult.classList.contains('hidden')) {
      renderResult(state.winner);
    }
    notify('Счётчики действий очищены');
  }

  function updateAvailable() {
    const items = state.ready ? getFilteredItems() : [];
    if (el.rouletteAvailable) {
      el.rouletteAvailable.textContent = state.loading ? 'Загрузка…' : countLabel(items.length);
    }
    const noItems = state.ready && items.length === 0 && !state.error;
    const showEmpty = noItems || Boolean(state.error);
    if (el.rouletteEmpty) el.rouletteEmpty.classList.toggle('hidden', !showEmpty);
    if (el.rouletteSpin) {
      el.rouletteSpin.disabled = !state.ready || state.running || items.length === 0;
      if (!state.running) el.rouletteSpin.textContent = 'Крутить рулетку';
    }
  }

  function setStatus(message) {
    if (el.rouletteStatus) el.rouletteStatus.textContent = message;
  }

  function setControlsDisabled(disabled) {
    const controls = [
      el.rouletteBrand,
      el.rouletteStrength,
      el.rouletteCategory,
      el.rouletteRating,
      el.roulettePhoto,
      el.rouletteLimited,
      el.rouletteDiscontinued,
      el.rouletteFast
    ];
    for (const control of controls) {
      if (control) control.disabled = disabled;
    }
    if (el.rouletteSpin) {
      el.rouletteSpin.disabled = disabled || !state.ready || getFilteredItems().length === 0;
      el.rouletteSpin.textContent = disabled ? 'Крутим…' : 'Крутить рулетку';
    }
  }

  function createPlaceholder(item) {
    const placeholder = document.createElement('div');
    placeholder.className = 'media-placeholder';
    const span = document.createElement('span');
    span.textContent = String(item && (item.brand || item.name) ? (item.brand || item.name).trim().charAt(0) : 'D').toUpperCase();
    placeholder.append(span);
    return placeholder;
  }

  function createMedia(item, className, options) {
    const settings = options || {};
    const wrapper = document.createElement('div');
    wrapper.className = `${className} comic-photo`;
    const category = (item && item.groups || []).join(' ');
    const tones = [[/ягод/i, 'berry'], [/мят|трав|свеж/i, 'mint'], [/напит/i, 'drink'], [/десерт|слад/i, 'dessert'], [/прян|спец/i, 'spice']];
    wrapper.dataset.comicTone = (tones.find(([pattern]) => pattern.test(category)) || [null, 'fruit'])[1];
    wrapper.append(createPlaceholder(item));
    if (item && item.groups && item.groups.length) {
      const sticker = document.createElement('span');
      sticker.className = 'photo-sticker';
      sticker.textContent = item.groups[0];
      wrapper.append(sticker);
    }

    if (!item || !item.image_url) return wrapper;

    const image = document.createElement('img');
    image.src = item.image_url;
    image.alt = `${item.name}${item.brand ? ` — ${item.brand}` : ''}`;
    image.loading = settings.eager ? 'eager' : 'lazy';
    image.decoding = 'async';
    image.addEventListener('load', () => wrapper.classList.add('has-photo'), { once: true });
    image.addEventListener(
      'error',
      () => {
        image.remove();
      },
      { once: true }
    );
    wrapper.append(image);
    return wrapper;
  }

  function createChips(item, max) {
    const fragment = document.createDocumentFragment();
    const limit = max || 4;
    if (!item) return fragment;

    if (item.limited) {
      const chip = document.createElement('span');
      chip.className = 'chip chip-limited';
      chip.textContent = 'Лимитированный';
      fragment.append(chip);
    }
    if (item.discontinued) {
      const chip = document.createElement('span');
      chip.className = 'chip chip-danger';
      chip.textContent = 'Снят с производства';
      fragment.append(chip);
    }

    const values = (item.tastes && item.tastes.length ? item.tastes : item.groups || []).slice(0, limit);
    for (const value of values) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = value;
      fragment.append(chip);
    }
    return fragment;
  }

  function renderReelCard(item) {
    const card = document.createElement('article');
    card.className = 'reel-card';
    card.dataset.slug = item.slug;

    const media = createMedia(item, 'reel-media');
    const body = document.createElement('div');
    body.className = 'reel-body';

    const brand = document.createElement('span');
    brand.className = 'reel-brand';
    brand.textContent = item.brand;

    const name = document.createElement('strong');
    name.className = 'reel-name';
    name.textContent = item.name;

    const meta = document.createElement('span');
    meta.className = 'reel-meta';
    meta.textContent = [item.strength, Number.isFinite(item.rating) && item.rating > 0 ? `★ ${item.rating}` : '']
      .filter(Boolean)
      .join(' · ') || item.alt_name || '—';

    body.append(brand, name, meta);
    card.append(media, body);
    return card;
  }

  function buildReel(items, winner) {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < REEL_CARDS; index += 1) {
      const item = index === WINNER_INDEX ? winner : Core.pickRandomItem(items, randomUnit) || winner;
      const card = renderReelCard(item);
      card.dataset.index = String(index);
      if (index === WINNER_INDEX) card.dataset.winner = 'true';
      fragment.append(card);
    }
    if (!el.rouletteTrack) return;
    el.rouletteTrack.replaceChildren(fragment);
    el.rouletteTrack.style.transition = 'none';
    el.rouletteTrack.style.transform = 'translate3d(0, 0, 0)';
    void el.rouletteTrack.offsetWidth;
    state.winnerIndex = WINNER_INDEX;
  }

  function positionReel(duration) {
    if (!el.rouletteTrack || !el.rouletteWindow) return;
    const winnerCard = el.rouletteTrack.children[state.winnerIndex];
    if (!winnerCard) return;

    const styles = window.getComputedStyle(el.rouletteTrack);
    const gap = parseFloat(styles.columnGap || styles.gap) || 12;
    const cardWidth = winnerCard.getBoundingClientRect().width;
    const windowWidth = el.rouletteWindow.clientWidth;
    if (!cardWidth || !windowWidth) return;
    const target = Math.max(0, state.winnerIndex * (cardWidth + gap) + cardWidth / 2 - windowWidth / 2);
    const transform = `translate3d(${-target}px, 0, 0)`;

    if (!duration) {
      el.rouletteTrack.style.transition = 'none';
      el.rouletteTrack.style.transform = transform;
      return;
    }

    el.rouletteTrack.style.transition = 'none';
    el.rouletteTrack.style.transform = 'translate3d(0, 0, 0)';
    void el.rouletteTrack.offsetWidth;
    requestAnimationFrame(() => {
      if (!el.rouletteTrack) return;
      el.rouletteTrack.style.transition = `transform ${duration}ms cubic-bezier(0.1, 0.72, 0.08, 1)`;
      el.rouletteTrack.style.transform = transform;
    });
  }

  function renderIdleReel() {
    if (!state.ready || state.running || !el.rouletteTrack) return;
    const items = getFilteredItems();
    if (!items.length) {
      el.rouletteTrack.replaceChildren();
      return;
    }

    const fragment = document.createDocumentFragment();
    const count = Math.min(IDLE_CARDS, Math.max(8, items.length));
    for (let index = 0; index < count; index += 1) {
      fragment.append(renderReelCard(Core.pickRandomItem(items, randomUnit)));
    }
    el.rouletteTrack.replaceChildren(fragment);
    el.rouletteTrack.style.transition = 'none';
    el.rouletteTrack.style.transform = 'translate3d(0, 0, 0)';
  }

  function refreshRoulette(priority) {
    if (state.running) return;
    if (!state.ready) {
      updateAvailable();
      return;
    }
    updateFacetedFilters(priority);
    if (el.rouletteResult) el.rouletteResult.classList.add('hidden');
    updateAvailable();
    renderIdleReel();
  }

  function renderResult(item) {
    if (!el.rouletteResult || !item) return;
    el.rouletteResult.replaceChildren();

    const card = document.createElement('article');
    card.className = 'result-card';

    const media = createMedia(item, 'result-media', { eager: true });
    const body = document.createElement('div');
    body.className = 'result-body';

    const kicker = document.createElement('span');
    kicker.className = 'result-kicker';
    kicker.textContent = [item.brand, item.line].filter(Boolean).join(' · ');

    const title = document.createElement('h3');
    title.className = 'result-name';
    title.textContent = item.name;

    const alt = document.createElement('p');
    alt.className = 'result-alt';
    alt.textContent = item.alt_name || '';

    const chips = document.createElement('div');
    chips.className = 'chip-row';
    chips.append(createChips(item, 6));

    const collectionEntry = getCollectionEntry(item.slug);
    if (collectionEntry) {
      const stateChip = document.createElement('span');
      stateChip.className = `chip chip-state ${collectionEntry.tried ? 'chip-tried' : 'chip-wish'}`;
      stateChip.textContent = collectionEntry.tried ? 'В коллекции · попробовал' : 'В коллекции · хочу';
      chips.append(stateChip);
    }
    if (isInHistory(item)) {
      const historyChip = document.createElement('span');
      historyChip.className = 'chip chip-state chip-history';
      historyChip.textContent = 'Уже был в истории покура';
      chips.append(historyChip);
    }

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    const metaParts = [];
    if (Number.isFinite(item.rating) && item.rating > 0) metaParts.push(`★ ${item.rating}`);
    if (item.strength) metaParts.push(item.strength);
    if (Number.isFinite(item.reviews_count) && item.reviews_count > 0) {
      metaParts.push(`${formatNumber(item.reviews_count)} ${plural(item.reviews_count, 'отзыв', 'отзыва', 'отзывов')}`);
    }
    meta.textContent = metaParts.join(' · ') || 'Характеристики не указаны';

    const actions = document.createElement('div');
    actions.className = 'result-actions';

    const inCollection = isInCollection(item.slug);
    const wish = document.createElement('button');
    wish.type = 'button';
    wish.className = 'btn btn-primary';
    wish.id = 'roulette-wish';
    wish.textContent = inCollection ? 'В коллекции ✓' : 'Хочу покурить';
    wish.disabled = inCollection;

    const again = document.createElement('button');
    again.type = 'button';
    again.className = 'btn btn-ghost';
    again.id = 'roulette-again';
    again.textContent = 'Крутить ещё раз';

    const link = document.createElement('a');
    link.className = 'text-link result-link';
    link.href = item.source_url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'На HTReviews ↗';

    actions.append(wish, again, link);
    body.append(kicker, title);
    if (item.alt_name) body.append(alt);
    body.append(chips, meta, actions);
    card.append(media, body);
    el.rouletteResult.append(card);
    el.rouletteResult.classList.remove('hidden');
    el.rouletteResult.classList.remove('is-visible');
    void el.rouletteResult.offsetWidth;
    el.rouletteResult.classList.add('is-visible');
  }

  function finishSpin() {
    if (!state.running) return;
    clearTimeout(state.spinTimer);
    state.spinTimer = null;
    state.running = false;

    if (el.rouletteWindow) el.rouletteWindow.classList.remove('is-spinning');
    setControlsDisabled(false);

    const winner = state.winner;
    const cards = el.rouletteTrack ? el.rouletteTrack.children : [];
    if (cards[state.winnerIndex]) cards[state.winnerIndex].classList.add('is-winner');

    if (winner) {
      renderResult(winner);
      state.spinCount += 1;
      saveSpins();
      updateUserStats();
      setStatus(`Выпал «${winner.name}» — ${winner.brand}.`);
      if (window.innerWidth < 760 && state.activeTab === 'roulette') {
        setTimeout(() => {
          if (el.rouletteResult && state.activeTab === 'roulette') {
            el.rouletteResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 120);
      }
    }

    updateAvailable();
  }

  function spinRoulette() {
    if (state.running || !state.ready) return;
    const items = getFilteredItems();
    if (!items.length) {
      updateAvailable();
      setStatus('Под выбранные фильтры не осталось вкусов.');
      return;
    }

    const winner = Core.pickRandomItem(items, randomUnit);
    if (!winner) return;

    state.winner = winner;
    state.running = true;
    if (el.rouletteResult) el.rouletteResult.classList.add('hidden');
    if (el.rouletteEmpty) el.rouletteEmpty.classList.add('hidden');
    setControlsDisabled(true);
    buildReel(items, winner);

    if (state.fast) {
      positionReel(0);
      finishSpin();
      return;
    }

    if (el.rouletteWindow) el.rouletteWindow.classList.add('is-spinning');
    setStatus('Рулетка крутится…');
    positionReel(SPIN_MS);
    state.spinTimer = setTimeout(finishSpin, SPIN_MS + 350);
  }

  function addWinnerToCollection() {
    if (!state.winner) return;
    const result = Core.addToCollection(state.collection, state.winner);
    if (result.added) {
      state.collection = result.collection;
      saveCollection();
      renderCollection();
      updateUserStats();
      notify(`«${state.winner.name}» добавлен в коллекцию`);
      if (el.rouletteResult && !el.rouletteResult.classList.contains('hidden')) renderResult(state.winner);
      const button = byId('roulette-wish');
      if (button) {
        button.textContent = 'В коллекции ✓';
        button.disabled = true;
      }
    } else if (result.reason === 'duplicate') {
      notify('Этот вкус уже в коллекции');
      const button = byId('roulette-wish');
      if (button) {
        button.textContent = 'В коллекции ✓';
        button.disabled = true;
      }
    }
  }

  function getCollectionItem(entry) {
    const item = state.bySlug.get(entry.slug);
    if (item) return item;
    const tail = entry.slug.split('/').pop() || entry.slug;
    return {
      slug: entry.slug,
      name: tail.replace(/-/g, ' '),
      alt_name: '',
      brand: 'Нет в каталоге',
      line: '',
      image_url: '',
      tastes: [],
      groups: [],
      strength: '',
      rating: null,
      reviews_count: null,
      limited: false,
      discontinued: false,
      source_url: `https://htreviews.org/tobaccos/${entry.slug}`
    };
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  function renderCollectionCard(entry) {
    const item = getCollectionItem(entry);
    const card = document.createElement('article');
    card.className = `collection-item${entry.tried ? ' is-tried' : ''}`;

    const media = createMedia(item, 'collection-media');
    const flag = document.createElement('span');
    flag.className = `collection-flag${entry.tried ? ' is-tried' : ''}`;
    flag.textContent = entry.tried ? 'Попробовал' : 'Хочу';
    media.append(flag);

    const body = document.createElement('div');
    body.className = 'collection-body';

    const brand = document.createElement('span');
    brand.className = 'collection-brand';
    brand.textContent = [item.brand, item.line].filter(Boolean).join(' · ');

    const title = document.createElement('h3');
    title.className = 'collection-name';
    title.textContent = item.name;

    const alt = document.createElement('p');
    alt.className = 'collection-alt';
    alt.textContent = item.alt_name || '';

    const chips = document.createElement('div');
    chips.className = 'chip-row';
    chips.append(createChips(item, 3));

    const meta = document.createElement('div');
    meta.className = 'collection-meta';
    const metaParts = [];
    if (Number.isFinite(item.rating) && item.rating > 0) metaParts.push(`★ ${item.rating}`);
    if (item.strength) metaParts.push(item.strength);
    if (entry.addedAt) metaParts.push(`добавлен ${formatDate(entry.addedAt)}`);
    meta.textContent = metaParts.join(' · ');

    const actions = document.createElement('div');
    actions.className = 'collection-actions';

    const fill = document.createElement('button');
    fill.type = 'button';
    fill.className = 'btn btn-small btn-primary';
    fill.dataset.collectionAction = 'fill';
    fill.dataset.slug = entry.slug;
    fill.textContent = 'В чашу';

    const tried = document.createElement('button');
    tried.type = 'button';
    tried.className = 'btn btn-small btn-ghost';
    tried.dataset.collectionAction = 'tried';
    tried.dataset.slug = entry.slug;
    tried.textContent = entry.tried ? 'Вернуть в «Хочу»' : 'Уже попробовал';

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-small btn-danger-ghost';
    remove.dataset.collectionAction = 'remove';
    remove.dataset.slug = entry.slug;
    remove.textContent = 'Удалить';

    const link = document.createElement('a');
    link.className = 'text-link';
    link.href = item.source_url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = 'HTReviews ↗';

    actions.append(fill, tried, remove, link);
    body.append(brand, title);
    if (item.alt_name) body.append(alt);
    body.append(chips, meta, actions);
    card.append(media, body);
    return card;
  }

  function renderCollection() {
    syncProductSaves();
    updateUserStats();
    if (!el.collectionList) return;

    const stats = Core.collectionStats(state.collection);
    const query = state.collectionSearch.trim().toLowerCase();
    const entries = state.collection
      .slice()
      .sort((a, b) => String(b.addedAt || '').localeCompare(String(a.addedAt || '')))
      .filter((entry) => {
        if (state.collectionFilter === 'wish' && entry.tried) return false;
        if (state.collectionFilter === 'tried' && !entry.tried) return false;
        if (!query) return true;
        const item = getCollectionItem(entry);
        return `${item.name} ${item.alt_name} ${item.brand} ${item.line}`.toLowerCase().includes(query);
      });

    for (const button of document.querySelectorAll('[data-collection-filter]')) {
      button.classList.toggle('is-active', button.dataset.collectionFilter === state.collectionFilter);
    }

    el.collectionList.replaceChildren();

    if (!state.collection.length) {
      if (el.collectionEmpty) el.collectionEmpty.classList.remove('hidden');
      updateUserStats();
      return;
    }

    if (el.collectionEmpty) el.collectionEmpty.classList.add('hidden');

    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'muted collection-note';
      empty.textContent = stats.total
        ? 'В этой выборке ничего нет. Измените фильтр или поиск.'
        : 'Коллекция пока пуста.';
      el.collectionList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const entry of entries) fragment.append(renderCollectionCard(entry));
    el.collectionList.append(fragment);
    updateUserStats();
  }

  function renderErrorState(error) {
    const message = window.location.protocol === 'file:'
      ? 'Каталог не загрузился. Откройте проект через локальный HTTP-сервер.'
      : 'Не удалось загрузить flavors.json. Проверьте соединение и попробуйте ещё раз.';

    updateHeaderStatus();

    if (el.rouletteAvailable) el.rouletteAvailable.textContent = '0 вкусов';
    if (el.rouletteSpin) el.rouletteSpin.disabled = true;
    if (el.rouletteTrack) el.rouletteTrack.replaceChildren();
    if (el.rouletteResult) el.rouletteResult.classList.add('hidden');
    if (el.rouletteEmpty) {
      el.rouletteEmpty.classList.remove('hidden');
      el.rouletteEmpty.replaceChildren();
      const icon = document.createElement('span');
      icon.className = 'empty-icon';
      icon.textContent = '!';
      const title = document.createElement('strong');
      title.textContent = 'Каталог не загрузился';
      const text = document.createElement('p');
      text.textContent = message;
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'btn btn-primary';
      retry.textContent = 'Повторить';
      retry.addEventListener('click', () => window.location.reload());
      el.rouletteEmpty.append(icon, title, text, retry);
    }
    setStatus(message);

    renderCollection();
    console.error('[DimHookah] Не удалось загрузить каталог:', error);
  }

  async function loadCatalog() {
    state.loading = true;
    state.error = null;
    updateHeaderStatus();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const response = await fetch('flavors.json', { cache: 'default', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.json();
      const catalog = Core.normalizeCatalog(raw);
      if (!catalog.length) throw new Error('Каталог пуст');

      state.catalog = catalog;
      state.bySlug = new Map(catalog.map((item) => [item.slug, item]));
      state.stats = Core.computeCatalogStats(catalog);
      state.ready = true;
      state.loading = false;
      state.error = null;
      filteredKey = null;
      filteredItems = [];

      updateHeaderStatus();
      renderCollection();
      refreshRoulette(null);
      updateUserStats();
      initCatalogBrowser();
      window.dispatchEvent(new CustomEvent('dimhookah:catalog-ready', { detail: { catalog } }));
    } catch (error) {
      state.loading = false;
      state.ready = false;
      state.error = error;
      renderErrorState(error);
      byId('home-products').textContent = 'Не удалось загрузить вкусы. Проверьте подключение и обновите страницу.';
      byId('catalog-total').textContent = 'Нет подключения';
      byId('catalog-products').textContent = 'Каталог недоступен. Проверьте подключение и обновите страницу.';
    } finally {
      clearTimeout(timeout);
    }
  }

  function initRouletteControls() {
    const facetControls = [
      [el.rouletteBrand, 'brand'],
      [el.rouletteStrength, 'strength'],
      [el.rouletteCategory, 'category'],
      [el.rouletteRating, 'rating']
    ];
    for (const [control, dimension] of facetControls) {
      if (control) control.addEventListener('change', () => refreshRoulette(dimension));
    }

    for (const control of [el.roulettePhoto, el.rouletteLimited, el.rouletteDiscontinued]) {
      if (control) control.addEventListener('change', () => refreshRoulette(null));
    }

    if (el.rouletteFast) {
      el.rouletteFast.addEventListener('change', () => {
        state.fast = el.rouletteFast.checked;
        saveFast(state.fast);
      });
    }

    if (el.rouletteSpin) el.rouletteSpin.addEventListener('click', spinRoulette);

    if (el.rouletteResult) {
      el.rouletteResult.addEventListener('click', (event) => {
        if (event.target.closest('#roulette-wish')) {
          addWinnerToCollection();
          return;
        }
        if (event.target.closest('#roulette-again')) spinRoulette();
      });
    }

    if (el.rouletteTrack) {
      el.rouletteTrack.addEventListener('transitionend', (event) => {
        if (event.target === el.rouletteTrack && event.propertyName === 'transform') finishSpin();
      });
    }

    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (state.running || state.activeTab !== 'roulette') return;
        if (state.winner && el.rouletteResult && !el.rouletteResult.classList.contains('hidden')) {
          positionReel(0);
        }
      }, 160);
    });
  }

  function initCollectionControls() {
    if (el.clearUserStats) el.clearUserStats.addEventListener('click', clearActionStats);

    window.addEventListener('dimhookah:history-ready', () => {
      if (state.winner && el.rouletteResult && !el.rouletteResult.classList.contains('hidden')) {
        renderResult(state.winner);
      }
    });

    if (el.collectionSearch) {
      el.collectionSearch.addEventListener('input', () => {
        state.collectionSearch = el.collectionSearch.value;
        renderCollection();
      });
    }

    for (const button of document.querySelectorAll('[data-collection-filter]')) {
      button.addEventListener('click', () => {
        state.collectionFilter = button.dataset.collectionFilter;
        renderCollection();
      });
    }

    if (el.collectionList) {
      el.collectionList.addEventListener('click', (event) => {
        const action = event.target.closest('[data-collection-action]');
        if (!action) return;
        const slug = action.dataset.slug;
        if (!slug) return;

        if (action.dataset.collectionAction === 'fill') {
          const item = getCollectionItem({ slug });
          if (!item) {
            notify('Не удалось найти вкус в каталоге');
            return;
          }
          if (typeof window.fillSessionFromCollection === 'function') {
            window.fillSessionFromCollection({ brand: item.brand, flavor: item.name, slug: item.slug });
          }
          return;
        }

        if (action.dataset.collectionAction === 'remove') {
          state.collection = Core.removeFromCollection(state.collection, slug);
          saveCollection();
          renderCollection();
          updateUserStats();
          notify('Вкус удалён из коллекции');
          return;
        }

        if (action.dataset.collectionAction === 'tried') {
          const previous = state.collection.find((entry) => entry.slug === slug);
          state.collection = Core.toggleCollectionTried(state.collection, slug);
          saveCollection();
          renderCollection();
          updateUserStats();
          notify(previous && previous.tried ? 'Вкус возвращён в «Хочу»' : 'Отмечено как попробованное');
        }
      });
    }
  }

  // Render only the current page of the catalog, never thousands of images at once.
  let catalogLimit = 24;
  function saveCatalogItem(item) {
    const result = Core.addToCollection(state.collection, item);
    if (result.added) {
      state.collection = result.collection;
      saveCollection();
      renderCollection();
      updateUserStats();
      notify(`«${item.name}» добавлен в коллекцию`);
    } else notify('Этот вкус уже в коллекции');
    syncProductSaves();
  }

  function syncProductSaves() {
    document.querySelectorAll('[data-save-product]').forEach((button) => {
      const saved = isInCollection(button.dataset.saveProduct);
      button.setAttribute('aria-pressed', String(saved));
      button.textContent = saved ? '♥' : '♡';
      button.setAttribute('aria-label', saved ? 'В коллекции' : 'Добавить в коллекцию');
    });
  }

  function productCard(item) {
    const article = document.createElement('article');
    article.className = 'product-card';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'product-open';
    open.setAttribute('aria-label', `${item.brand} ${item.name}, подробнее`);
    open.append(createMedia(item, 'product-media'));
    const copy = document.createElement('div');
    copy.className = 'product-copy';
    const brand = document.createElement('span');
    brand.className = 'product-brand'; brand.textContent = item.brand;
    const title = document.createElement('strong');
    title.className = 'product-name'; title.textContent = item.name;
    const rating = document.createElement('span');
    rating.className = 'product-rating';
    const star = document.createElement('b'); star.textContent = '★ ';
    rating.append(star, item.rating > 0 ? String(item.rating) : 'Нет оценки');
    copy.append(brand, title, rating); open.append(copy);
    open.addEventListener('click', () => openProduct(item));
    const save = document.createElement('button');
    save.type = 'button'; save.className = 'product-save'; save.dataset.saveProduct = item.slug;
    save.addEventListener('click', () => saveCatalogItem(item));
    article.append(open, save);
    return article;
  }

  function openProduct(item) {
    let dialog = byId('product-detail');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.id = 'product-detail'; dialog.className = 'product-detail';
      dialog.setAttribute('aria-labelledby', 'detail-title');
      dialog.addEventListener('click', (event) => { if (event.target === dialog && (event.clientX < dialog.getBoundingClientRect().left || event.clientX > dialog.getBoundingClientRect().right || event.clientY < dialog.getBoundingClientRect().top || event.clientY > dialog.getBoundingClientRect().bottom)) dialog.close(); });
      document.body.append(dialog);
    }
    dialog.replaceChildren();
    const close = document.createElement('button'); close.type = 'button'; close.className = 'detail-close'; close.textContent = 'Закрыть ×'; close.onclick = () => dialog.close();
    const title = document.createElement('h2'); title.id = 'detail-title'; title.textContent = item.name;
    const meta = document.createElement('p'); meta.textContent = [item.brand, item.line, item.strength, item.rating > 0 ? `★ ${item.rating}` : ''].filter(Boolean).join(' · ');
    const tastes = document.createElement('p'); tastes.textContent = item.tastes.length ? item.tastes.join(' · ') : 'Ароматы не указаны в каталоге';
    const save = document.createElement('button'); save.type = 'button'; save.className = 'btn btn-primary'; save.textContent = isInCollection(item.slug) ? 'В коллекции ✓' : 'Хочу покурить ♡'; save.disabled = isInCollection(item.slug);
    save.onclick = () => { saveCatalogItem(item); save.textContent = 'В коллекции ✓'; save.disabled = true; };
    const link = document.createElement('a'); link.href = item.source_url; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Подробнее на HTReviews ↗';
    dialog.append(close, createMedia(item, 'detail-media', { eager: true }), title, meta, tastes, save, link);
    dialog.showModal();
  }

  function renderCatalogBrowser() {
    const query = byId('catalog-search').value.trim().toLocaleLowerCase('ru');
    const brand = byId('catalog-brand').value;
    const group = byId('catalog-group').value;
    const items = state.catalog.filter((item) => !item.discontinued && (!brand || item.brand === brand) && (!group || item.groups.includes(group)) && (!query || [item.brand, item.name, item.alt_name, ...item.tastes].join(' ').toLocaleLowerCase('ru').includes(query)));
    items.sort(byId('catalog-sort').value === 'name' ? (a, b) => a.name.localeCompare(b.name, 'ru') : (a, b) => (b.rating || 0) - (a.rating || 0) || (b.ratings_count || 0) - (a.ratings_count || 0));
    byId('catalog-total').textContent = countLabel(items.length);
    const list = byId('catalog-products');
    list.replaceChildren(...items.slice(0, catalogLimit).map(productCard));
    if (!items.length) { const message = document.createElement('p'); message.className = 'empty-state'; message.textContent = state.error ? 'Каталог недоступен. Проверьте подключение и обновите страницу.' : 'Ничего не найдено. Попробуйте другой запрос или измените фильтры.'; list.append(message); }
    byId('catalog-more').hidden = items.length <= catalogLimit;
    syncProductSaves();
  }

  function initCatalogBrowser() {
    const active = state.catalog.filter((item) => !item.discontinued);
    for (const [id, values] of [['catalog-brand', active.map((item) => item.brand)], ['catalog-group', active.flatMap((item) => item.groups)]]) {
      const select = byId(id);
      for (const value of [...new Set(values)].sort((a, b) => a.localeCompare(b, 'ru'))) {
        const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option);
      }
    }
    for (const id of ['catalog-search', 'catalog-brand', 'catalog-group', 'catalog-sort']) byId(id).addEventListener(id === 'catalog-search' ? 'input' : 'change', () => { catalogLimit = 24; renderCatalogBrowser(); });
    byId('catalog-more').addEventListener('click', () => { catalogLimit += 24; renderCatalogBrowser(); });
    // Feature a range of brands, using the real catalog rating and image URLs.
    const featured = []; const brands = new Set();
    for (const item of [...active].filter((item) => item.image_url && item.rating > 0).sort((a, b) => (b.ratings_count || 0) - (a.ratings_count || 0))) {
      if (!brands.has(item.brand)) { brands.add(item.brand); featured.push(item); }
      if (featured.length === 4) break;
    }
    byId('home-products').replaceChildren(...featured.map(productCard));
    renderCatalogBrowser();
  }

  function initStorageSync() {
    window.addEventListener('storage', (event) => {
      if (event.key === KEYS.collection) {
        state.collection = Core.normalizeCollection(readJson(KEYS.collection, []));
        renderCollection();
        updateUserStats();
      }
      if (event.key === KEYS.fast) {
        state.fast = event.newValue === '1';
        if (el.rouletteFast) el.rouletteFast.checked = state.fast;
      }
      if (event.key === KEYS.spins) {
        state.spinCount = Math.max(0, Number(event.newValue) || 0);
        updateUserStats();
      }
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;

    cacheElements();
    byId('panel-collection').append(byId('collection-card'), byId('user-stats-card'));
    loadPreferences();
    initTabs();
    initRouletteControls();
    initCollectionControls();
    initStorageSync();

    renderCollection();
    updateUserStats();
    updateHeaderStatus();
    loadCatalog();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // Небольшой публичный API для e2e/отладки.
  window.DimHookahUI = {
    showTab,
    getState: () => state,
    getFilteredItems,
    spinRoulette,
    addWinnerToCollection
  };
})();

