import { initProjectPageInstance } from './projectpage.js';

// ── Navigation ────────────────────────────────────────────────────────────────

export function goToProjectPage(pageEl) {
  const startScreen = document.getElementById('startScreen');
  startScreen.classList.add('hidden');
  startScreen.addEventListener('transitionend', () => {
    startScreen.style.display = 'none';
    pageEl.classList.add('visible');
  }, { once: true });
}

export function goBackToStartScreen(pageEl) {
  const startScreen = document.getElementById('startScreen');
  pageEl.classList.remove('visible');
  startScreen.style.display = '';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      startScreen.classList.remove('hidden');
    });
  });
  updateActiveCarouselItem();
}

// ── Karussell — flache horizontal scrollbare Reihe (wie the5011project.com) ──
const carouselRing  = document.getElementById('carousel-ring');
const carouselSceneEl = document.getElementById('carousel-scene');

function updateCarouselPositions() {
  // Flexbox übernimmt das Layout — keine Transforms nötig.
}

// Findet frisch (ohne auf die ggf. veraltete .active-Klasse zu vertrauen), welches
// Item gerade am nächsten an der Sichtfenster-Mitte liegt.
function findClosestCarouselItem() {
  const items = Array.from(carouselRing.children);
  if (items.length === 0) return null;
  const sceneRect = carouselSceneEl.getBoundingClientRect();
  const centerX   = sceneRect.left + sceneRect.width / 2;

  let closest = null, closestDist = Infinity;
  for (const item of items) {
    const r = item.getBoundingClientRect();
    const itemCenter = r.left + r.width / 2;
    const dist = Math.abs(itemCenter - centerX);
    if (dist < closestDist) { closestDist = dist; closest = item; }
  }
  return closest;
}

// Markiert das Item, dessen Mitte am nächsten an der Sichtfenster-Mitte liegt,
// als "active" (volle Deckkraft + OPEN-Button), alle anderen bleiben gedimmt.
function updateActiveCarouselItem() {
  const closest = findClosestCarouselItem();
  if (!closest) return;
  Array.from(carouselRing.children).forEach(item => item.classList.toggle('active', item === closest));
}

carouselSceneEl.addEventListener('scroll', updateActiveCarouselItem);

// Eigenes Snap-Verhalten statt nativem CSS scroll-snap (das in manchen Browsern
// bei vielen Items/größeren Distanzen falsche oder gar keine Snap-Ziele mehr
// findet). Nach Scroll-Ende (kein weiteres scroll-Event für 120ms) wird das
// gerade nächstgelegene Item per JS sanft in die Mitte geschoben.
let carouselSnapTimer = null;
carouselSceneEl.addEventListener('scroll', () => {
  clearTimeout(carouselSnapTimer);
  carouselSnapTimer = setTimeout(() => {
    const closest = findClosestCarouselItem();
    if (closest) closest.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, 120);
});

// Bewegt das Karussell um genau einen Platzhalter weiter (Pfeile/Pinch-Geste).
// Ermittelt das aktuelle Item frisch statt sich auf die .active-Klasse zu
// verlassen, damit neu hinzugefügte Platzhalter sofort erreichbar sind.
function moveCarousel(direction) {
  const current = findClosestCarouselItem();
  if (!current) return;
  const target = direction > 0 ? current.nextElementSibling : current.previousElementSibling;
  console.log(target);
  if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
}

// Statische Vorschaubilder pro Standard-Collection
const CAROUSEL_IMAGES = {
  'collection-1': '1.png',
  'collection-2': '2.png',
  'collection-3': '3.png',
};

// Fallback-Pool für dynamische Collections (zyklisch)
const FALLBACK_IMAGES = ['4.png', '5.png', '6.png', '7.png', '8.png', '9.jpg'];
let fallbackIdx = 0;

function addCarouselItem(root, titleText) {
  const item = document.createElement('div');
  item.className = 'carousel-item';

  const previewImg = document.createElement('img');
  previewImg.alt = '';

  const emptyEl = document.createElement('div');
  emptyEl.className   = 'start-card-empty';
  emptyEl.textContent = 'No image';

  const previewBox = document.createElement('div');
  previewBox.className = 'start-card-preview';
  previewBox.appendChild(previewImg);
  previewBox.appendChild(emptyEl);

  const label = document.createElement('span');
  label.className   = 'start-card-label';
  label.textContent = titleText ;

  const openBtn = document.createElement('button');
  openBtn.className   = 'start-card-open-btn';
  openBtn.textContent  = 'OPEN';
  openBtn.addEventListener('mouseenter', () => goToProjectPage(root));
  previewBox.appendChild(openBtn);

  const card = document.createElement('div');
  card.className = 'start-card';
  card.appendChild(previewBox);
  card.appendChild(label);
  card.addEventListener('click', () => goToProjectPage(root));

  item.appendChild(card);
  carouselRing.appendChild(item);
  updateCarouselPositions();
  updateActiveCarouselItem();

  const imageSrc = CAROUSEL_IMAGES[root.dataset.pageId]
    ?? FALLBACK_IMAGES[fallbackIdx++ % FALLBACK_IMAGES.length];
  previewImg.src = imageSrc;
  previewImg.classList.add('loaded');
  emptyEl.style.display = 'none';

  root._previewImgEl  = previewImg;
  root._carouselLabel = label;
  root._carouselItem  = item;
  return { previewImg, label };
}


// ── Neue Collection erstellen (Create new Collection) ────────────────────────
const projectPageTemplate = document.getElementById('project-page-template');
const startItemsEl        = document.getElementById('startItems');

// Persistenz: Liste aller dynamischen Collections in localStorage
export function saveCollectionList() {
  const items = Array.from(document.querySelectorAll('.pixelationPage[data-page-id]')).map(el => ({
    pageId: el.dataset.pageId,
    title:  el.querySelector('.pp-collection-title-input')?.value
  }));
  localStorage.setItem('cc-collections', JSON.stringify(items));
}

export function spawnProjectPage(pageId, title, navigate) {
  const root = projectPageTemplate.content.firstElementChild.cloneNode(true);
  root.dataset.pageId = pageId;
  document.body.appendChild(root);

  const titleInput = root.querySelector('.pp-collection-title-input');
  if (title) titleInput.value = title;

  const { label } = addCarouselItem(root, title );

  const startBtn = document.createElement('span');
  startBtn.textContent = title ;
  startBtn.addEventListener('click', () => goToProjectPage(root));

  initProjectPageInstance(root, startBtn, { goToProjectPage, goBackToStartScreen, saveCollectionList });

  titleInput.addEventListener('input', () => {
    const val = titleInput.value.trim();
    label.textContent = val ;
    startBtn.textContent = val ;
    saveCollectionList();
  });

  if (navigate) goToProjectPage(root);
  return root;
}

export function createNewProjectPage() {
  const pageId = 'dynamic-' + Date.now();
  spawnProjectPage(pageId, '', true);
  saveCollectionList();
}

document.getElementById('btn-create').addEventListener('click', createNewProjectPage);

// Gespeicherte Collections beim Laden wiederherstellen
try {
  const saved = JSON.parse(localStorage.getItem('cc-collections') || '[]');
  if (saved.length === 0) {
    spawnProjectPage('collection-1', 'undefined', false);
    spawnProjectPage('collection-2', 'undefined', false);
    spawnProjectPage('collection-3', 'undefined', false);
  } else {
    saved.forEach(({ pageId, title }) => spawnProjectPage(pageId, title, false));
  }
} catch (e) { /* ignore corrupt data */ }

requestAnimationFrame(updateActiveCarouselItem);

// ── Hand-Tracking-Interaktion auf dem Start Screen ────────────────────────────
// window._indexTipX/Y wird von landingpage.js's initGrid() pro Kamera-Frame
// gesetzt (Viewport-Pixel). "Berührt" man Logo/Create-Button mit der
// Zeigefinger-Kuppe, wird der vorhandene Click-Handler ausgelöst — kein
// Doppel-Trigger solange der Finger im Element bleibt. Das Karussell selbst
// wird NICHT mehr per Zeigefinger-Bewegung gescrollt — nur noch per Pinch-
// Geste (Daumen+Zeigefinger berühren sich) oder Maus-Drag.
const startScreenEl     = document.getElementById('startScreen');
const landingPageEl     = document.getElementById('landingPage');
const logoEl            = document.getElementById('logo');
const btnCreateEl        = document.getElementById('btn-create');
const handCursorEls     = Array.from(document.querySelectorAll('.hand-cursor'));
const thumbCursorEls    = Array.from(document.querySelectorAll('.thumb-cursor'));
const arrowLeftEl       = document.getElementById('arrow-left');
const arrowRightEl      = document.getElementById('arrow-right');

function flashArrow(el) {
  if (!el) return;
  el.classList.add('active');
  setTimeout(() => el.classList.remove('active'), 200);
}
if (arrowLeftEl)  arrowLeftEl.addEventListener('click', () => { flashArrow(arrowLeftEl);  moveCarousel(-1); });
if (arrowRightEl) arrowRightEl.addEventListener('click', () => { flashArrow(arrowRightEl); moveCarousel(1); });

let touchedLogo = false, touchedCreate = false;
let wasPinchLeft = false, wasPinchRight = false;
const CAROUSEL_SCROLL_PER_PX = 1.5; // nur für Maus-Drag, nicht mehr für Zeigefinger-Tracking

let dwellBtnEl = null;

function pointInRect(x, y, el) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

(function handInteractionLoop() {
  requestAnimationFrame(handInteractionLoop);
  const x = window._indexTipX, y = window._indexTipY;
  // Marker erst sichtbar, sobald die Landing Page komplett ausgeblendet ist
  // (display:none, gesetzt nach ihrem Ausblend-Transition in landingpage.js).
  const landingGone = landingPageEl.style.display === 'none';

  if (x == null || y == null || startScreenEl.style.display === 'none' || !landingGone) {
    touchedLogo = false; touchedCreate = false;
    dwellBtnEl = null;
    wasPinchLeft = false; wasPinchRight = false;
    if (arrowLeftEl)  arrowLeftEl.classList.remove('active');
    if (arrowRightEl) arrowRightEl.classList.remove('active');
    handCursorEls.forEach(el => el.style.display = 'none');
    thumbCursorEls.forEach(el => el.style.display = 'none');
    carouselRing.querySelectorAll('.start-card-preview.finger-hover')
      .forEach(el => el.classList.remove('finger-hover'));
    return;
  }

  // ── Pinch-Geste (Daumen + Zeigefinger derselben Hand) → Pfeil-Karussell ────
  // window._pinchLeft/_pinchRight kommen pro Hand aus landingpage.js. Die
  // Pfeile müssen dafür nicht berührt werden — nur die Pinch-Geste zählt.
  const pinchRight = !!window._pinchRight, pinchLeft = !!window._pinchLeft;
  if (arrowRightEl) arrowRightEl.classList.toggle('active', pinchRight);
  if (arrowLeftEl)  arrowLeftEl.classList.toggle('active', pinchLeft);
  if (pinchRight && !wasPinchRight) moveCarousel(1);
  if (pinchLeft  && !wasPinchLeft)  moveCarousel(-1);
  wasPinchRight = pinchRight;
  wasPinchLeft  = pinchLeft;

  // Zeigefinger + Daumen jeder erkannten Hand (bis zu 2) gleichzeitig anzeigen.
  const handTips = window._handTips || [];
  handCursorEls.forEach((el, i) => {
    const tip = handTips[i];
    if (tip) {
      el.style.display = 'block';
      el.style.left = tip.indexX + 'px';
      el.style.top  = tip.indexY + 'px';
    } else {
      el.style.display = 'none';
    }
  });
  thumbCursorEls.forEach((el, i) => {
    const tip = handTips[i];
    if (tip) {
      el.style.display = 'block';
      el.style.left = tip.thumbX + 'px';
      el.style.top  = tip.thumbY + 'px';
    } else {
      el.style.display = 'none';
    }
  });

  handTips.forEach((tip, i) => {
    if (!tip) return;
    const dx = tip.indexX - tip.thumbX;
    const dy = tip.indexY - tip.thumbY;
    const pinching = Math.sqrt(dx * dx + dy * dy) < 60;
    handCursorEls[i]?.classList.toggle('pinch-active', pinching);
    thumbCursorEls[i]?.classList.toggle('pinch-active', pinching);
  });

  // Alle Fingerkuppen (Index + Daumen jeder Hand) als einheitliche Liste
  const allTips = handTips.flatMap(tip => tip
    ? [{ x: tip.indexX, y: tip.indexY }, { x: tip.thumbX, y: tip.thumbY }]
    : []);
  const anyInRect = el => allTips.some(t => pointInRect(t.x, t.y, el));

  if (logoEl && pointInRect(x, y, logoEl)) {
    if (!touchedLogo) { touchedLogo = true; logoEl.click(); }
  } else {
    touchedLogo = false;
  }

  if (btnCreateEl && pointInRect(x, y, btnCreateEl)) {
    if (!touchedCreate) { touchedCreate = true; btnCreateEl.click(); }
  } else {
    touchedCreate = false;
  }

  // OPEN-Button einblenden, sobald eine beliebige Fingerkuppe über dem aktiven
  // Platzhalter schwebt (Zeigefinger oder Daumen, jede Hand).
  const activePreview = carouselRing.querySelector('.carousel-item.active .start-card-preview');
  if (activePreview) {
    activePreview.classList.toggle('finger-hover', anyInRect(activePreview));
  }

  if (carouselSceneEl && anyInRect(carouselSceneEl)) {
    const btn = Array.from(carouselRing.querySelectorAll('.carousel-item.active .start-card-open-btn'))
      .find(b => anyInRect(b));

    if (btn !== dwellBtnEl) {
      if (dwellBtnEl) dwellBtnEl.classList.remove('finger-active');
      dwellBtnEl = btn || null;
      if (btn) {
        btn.classList.add('finger-active');
        btn.closest('.start-card').click(); // sofort öffnen, kein Verweilen mehr nötig
      }
    }
  } else {
    if (dwellBtnEl) dwellBtnEl.classList.remove('finger-active');
    dwellBtnEl = null;
  }
})();

// ── Maus-Drag-Scroll des Karussells (nur während gedrückter Maustaste,
// damit ein normaler Klick auf eine Karte weiterhin navigiert) ───────────────
let mouseDraggingCarousel = false, prevMouseCarouselX = null;
carouselSceneEl.addEventListener('mousedown', (e) => {
  mouseDraggingCarousel = true;
  prevMouseCarouselX = e.clientX;
});
window.addEventListener('mousemove', (e) => {
  if (!mouseDraggingCarousel) return;
  carouselSceneEl.scrollLeft -= (e.clientX - prevMouseCarouselX) * CAROUSEL_SCROLL_PER_PX;
  prevMouseCarouselX = e.clientX;
});
window.addEventListener('mouseup', () => {
  mouseDraggingCarousel = false;
  prevMouseCarouselX = null;
});
