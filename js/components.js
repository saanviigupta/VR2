/**
 * 🍰 Kawaii Bakery — A-Frame Components
 * components.js
 *
 * Unchanged gameplay behaviour. Notes:
 *  - pickupable + drop-zone hover/click work for BOTH the desktop cursor and
 *    the VR laser (laser-controls emits mouseenter/mouseleave/click).
 *  - Duplicate-input protection (double clicks from native + fallback VR
 *    input) is handled centrally in game.js (pickUpItem is idempotent).
 *  - desktop-interactor is inert while in VR (controllers take over).
 */

// Shared helper: only set emissive props on shaders that support them.
function safeSetEmissive(el, color, intensity) {
  try {
    const mat = el.getAttribute && el.getAttribute('material');
    if (!mat) return;
    if (mat.shader && mat.shader === 'flat') return; // flat: no emissive
    el.setAttribute('material', 'emissive', color);
    el.setAttribute('material', 'emissiveIntensity', intensity);
  } catch (e) {}
}

// ─────────────────────────────────────────────
// PICKUPABLE COMPONENT
// Makes an entity grabbable via cursor / laser click
// ─────────────────────────────────────────────
AFRAME.registerComponent('pickupable', {
  schema: {},

  init: function () {
    this.originalPos = this.el.getAttribute('position');
    this.originalRot = this.el.getAttribute('rotation');
    this.isPlaced = false;

    const setEmissive = (color, intensity) => {
      safeSetEmissive(this.el, color, intensity);
      this.el.querySelectorAll('*').forEach((ch) => safeSetEmissive(ch, color, intensity));
    };

    this.enterHandler = () => {
      if (this.isPlaced) return;
      setEmissive('#ffaae0', 0.45);
      this.el.removeAttribute('animation__hover');
      this.el.setAttribute('animation__hover', {
        property: 'scale', from: '1 1 1', to: '1.08 1.08 1.08', dur: 180, easing: 'easeOutQuad'
      });
      this.el.style.cursor = 'pointer';
    };

    this.leaveHandler = () => {
      if (this.isPlaced) return;
      setEmissive('#000000', 0);
      this.el.removeAttribute('animation__hover');
      this.el.setAttribute('scale', '1 1 1');
      this.el.style.cursor = '';
    };

    this.clickHandler = (e) => {
      if (this.isPlaced) return;
      e.stopPropagation();
      // In VR, e.detail.cursorEl is the controller that clicked — the held
      // item should follow that controller instead of the camera.
      const holder = (e.detail && e.detail.cursorEl) ? e.detail.cursorEl : null;
      if (window.bakeryGame) window.bakeryGame.pickUpItem(this.el, holder);
    };

    this.el.addEventListener('mouseenter', this.enterHandler);
    this.el.addEventListener('mouseleave', this.leaveHandler);
    this.el.addEventListener('click', this.clickHandler);
  },

  remove: function () {
    this.el.removeEventListener('mouseenter', this.enterHandler);
    this.el.removeEventListener('mouseleave', this.leaveHandler);
    this.el.removeEventListener('click', this.clickHandler);
  }
});

// ─────────────────────────────────────────────
// DESKTOP INTERACTOR (desktop only — inert in VR)
// ─────────────────────────────────────────────
AFRAME.registerComponent('desktop-interactor', {
  init: function () {
    const cursorEl = this.el;

    this.handleInteraction = (evt) => {
      try {
        if (cursorEl.sceneEl && cursorEl.sceneEl.is('vr-mode')) return;

        const rc = cursorEl.components && cursorEl.components.raycaster;
        if (!rc) return;
        const ints = rc.intersections;
        if (ints && ints.length > 0) {
          const hit = ints[0].object && ints[0].object.el;
          if (!hit) return;

          let el = hit;
          while (el && el !== cursorEl.sceneEl) {
            const cls = el.getAttribute && el.getAttribute('class');
            if (cls && ((' ' + cls + ' ').indexOf(' interactable ') >= 0 || (' ' + cls + ' ').indexOf(' drop-zone ') >= 0)) break;
            el = el.parentElement;
          }
          if (!el) el = hit;

          if (el && el.classList && el.classList.contains('interactable')) {
            if (window.bakeryGame && typeof window.bakeryGame.pickUpItem === 'function') {
              window.bakeryGame.pickUpItem(el);
            }
            if (evt && evt.stopPropagation) evt.stopPropagation();
            return;
          }

          if (el && el.classList && el.classList.contains('drop-zone')) {
            if (window.bakeryGame && typeof window.bakeryGame.tryPlace === 'function') {
              window.bakeryGame.tryPlace(el);
            }
            if (evt && evt.stopPropagation) evt.stopPropagation();
            return;
          }
        } else {
          if (window.bakeryGame && window.bakeryGame.heldItem) {
            window.bakeryGame.returnToOriginalSpot(window.bakeryGame.heldItem);
          }
        }
      } catch (e) {
        console.warn('desktop-interactor error', e);
      }
    };

    window.addEventListener('click', this.handleInteraction, true);
    window.addEventListener('mousedown', this.handleInteraction, true);
    window.addEventListener('touchstart', this.handleInteraction, { capture: true, passive: true });

    this.onKey = (ev) => {
      if (ev.key && (ev.key === 'e' || ev.key === 'E')) {
        this.handleInteraction(ev);
      }
    };
    window.addEventListener('keydown', this.onKey, false);
  },
  remove: function () {
    window.removeEventListener('click', this.handleInteraction, true);
    window.removeEventListener('mousedown', this.handleInteraction, true);
    window.removeEventListener('touchstart', this.handleInteraction, { capture: true, passive: true });
    window.removeEventListener('keydown', this.onKey, false);
  }
});

// ─────────────────────────────────────────────
// DROP-ZONE COMPONENT
// ─────────────────────────────────────────────
AFRAME.registerComponent('drop-zone', {
  schema: {},

  init: function () {
    this.filled = false;
    this.zoneType = this.el.getAttribute('zone-type');

    // Pulse the zone-visual's real material.emissiveIntensity property.
    const startPulse = () => {
      const visual = this.el.querySelector('.zone-visual');
      if (!visual) return;
      visual.setAttribute('animation__pulse', {
        property: 'material.emissiveIntensity',
        from: 0.3,
        to: 0.7,
        dur: 1200,
        dir: 'alternate',
        loop: true,
        easing: 'easeInOutSine',
      });
    };
    if (this.el.hasLoaded) setTimeout(startPulse, 0);
    else this.el.addEventListener('loaded', () => setTimeout(startPulse, 0));

    this.enterZone = () => {
      if (this.filled) return;
      const heldItem = window.bakeryGame && window.bakeryGame.heldItem;
      if (!heldItem) return;
      const itemType = heldItem.getAttribute('item-type');
      const isMatch  = (itemType === this.zoneType);
      const visual = this.el.querySelector('.zone-visual');
      if (visual) {
        visual.setAttribute('material', 'emissive', isMatch ? '#aaffcc' : '#ff8888');
        visual.setAttribute('material', 'emissiveIntensity', isMatch ? 0.9 : 0.8);
        visual.setAttribute('material', 'opacity', 0.85);
      }
    };

    this.leaveZone = () => {
      if (this.filled) return;
      const visual = this.el.querySelector('.zone-visual');
      if (visual) {
        const zoneColors = {
          croissant: '#ffb830', pastry: '#ff60b0', bread: '#e08820', dish: '#60c0ff', decoration: '#ff60b0'
        };
        visual.setAttribute('material', 'emissive', zoneColors[this.zoneType] || '#ffffff');
        visual.setAttribute('material', 'emissiveIntensity', 0.4);
        visual.setAttribute('material', 'opacity', 0.5);
      }
    };

    this.clickZone = (e) => {
      if (this.filled) return;
      e.stopPropagation();
      if (window.bakeryGame) window.bakeryGame.tryPlace(this.el);
    };

    this.el.addEventListener('mouseenter', this.enterZone);
    this.el.addEventListener('mouseleave', this.leaveZone);
    this.el.addEventListener('click', this.clickZone);
  },

  setFilled: function () {
    this.filled = true;
    const visual = this.el.querySelector('.zone-visual');
    if (visual) {
      visual.removeAttribute('animation__pulse');
      visual.setAttribute('material', 'color', '#aaffcc');
      visual.setAttribute('material', 'emissive', '#00ff88');
      visual.setAttribute('material', 'emissiveIntensity', 0.6);
      visual.setAttribute('material', 'opacity', 0.4);
    }
    this.el.setAttribute('animation__confirm', {
      property: 'scale',
      from: '1 1 1',
      to: '1.08 1.08 1.08',
      dur: 300,
      dir: 'alternate',
      loop: 2,
      easing: 'easeInOutSine',
    });
  },
  remove: function () {
    this.el.removeEventListener('mouseenter', this.enterZone);
    this.el.removeEventListener('mouseleave', this.leaveZone);
    this.el.removeEventListener('click', this.clickZone);
  }
});
