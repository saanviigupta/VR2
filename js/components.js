/**
 * 🍰 Kawaii Bakery — A-Frame Components
 * components.js
 *
 * Defines reusable A-Frame components:
 *  - pickupable     : items the player can click to hold
 *  - drop-zone      : glowing target areas for placement
 *  - hover-glow     : visual feedback on cursor hover
 */

// ─────────────────────────────────────────────
// PICKUPABLE COMPONENT
// Makes an entity grabbable via cursor click
// ─────────────────────────────────────────────
AFRAME.registerComponent('pickupable', {
  schema: {},

  init: function () {
    // Save initial transform for possible return
    this.originalPos = this.el.getAttribute('position');
    this.originalRot = this.el.getAttribute('rotation');
    this.isPlaced = false; // once placed correctly, becomes non-interactable

    // Helper: set visual feedback on the entity and its children.
    const setEmissive = (color, intensity) => {
      // If the entity has a material, set it; also try children
      try {
        if (this.el.getAttribute('material')) {
          this.el.setAttribute('material', 'emissive', color);
          this.el.setAttribute('material', 'emissiveIntensity', intensity);
        }
      } catch (e) {}
      // Iterate child meshes
      this.el.querySelectorAll('*').forEach((ch) => {
        try {
          if (ch.getAttribute('material')) {
            ch.setAttribute('material', 'emissive', color);
            ch.setAttribute('material', 'emissiveIntensity', intensity);
          }
        } catch (e) {}
      });
    };

    // Hover visuals: outline/glow using emissive and slight scale
    this.enterHandler = () => {
      if (this.isPlaced) return;
      setEmissive('#ffaae0', 0.45);
      this.el.removeAttribute('animation__hover');
      this.el.setAttribute('animation__hover', {
        property: 'scale', from: '1 1 1', to: '1.08 1.08 1.08', dur: 180, easing: 'easeOutQuad'
      });
      // show pointer cursor for desktop
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
      window.bakeryGame.pickUpItem(this.el);
    };

    this.el.addEventListener('mouseenter', this.enterHandler);
    this.el.addEventListener('mouseleave', this.leaveHandler);
    this.el.addEventListener('click', this.clickHandler);
  },

  remove: function () {
    // Clean up listeners when component removed
    this.el.removeEventListener('mouseenter', this.enterHandler);
    this.el.removeEventListener('mouseleave', this.leaveHandler);
    this.el.removeEventListener('click', this.clickHandler);
  }
});

// ─────────────────────────────────────────────
// DESKTOP INTERACTOR
// Ensures mouse clicks using the cursor + raycaster reliably
// pick up interactable entities and place them into drop zones.
// This centralizes click handling so child primitives or labels
// won't block interaction.
// ─────────────────────────────────────────────
AFRAME.registerComponent('desktop-interactor', {
  init: function () {
    const cursorEl = this.el; // attach this component to the cursor entity

    // On desktop mouse click, use the cursor's raycaster intersections
    // to determine what was clicked and forward it to bakeryGame.
    // Unified interaction handler usable by click/mousedown/touch and keyboard
    this.handleInteraction = (evt) => {
      try {
        const rc = cursorEl.components && cursorEl.components.raycaster;
        if (!rc) return;
        const ints = rc.intersections;
        if (ints && ints.length > 0) {
          const hit = ints[0].object && ints[0].object.el;
          if (!hit) return;

          // Find nearest ancestor with class 'interactable' or 'drop-zone'.
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
          // No raycaster hit — treat as drop-back if holding an item
          if (window.bakeryGame && window.bakeryGame.heldItem) {
            window.bakeryGame.returnToOriginalSpot(window.bakeryGame.heldItem);
          }
        }
      } catch (e) {
        console.warn('desktop-interactor error', e);
      }
    };

    // Listen for click/mousedown/touchstart so trackpad taps and presses are handled
    window.addEventListener('click', this.handleInteraction, true);
    window.addEventListener('mousedown', this.handleInteraction, true);
    window.addEventListener('touchstart', this.handleInteraction, { capture: true, passive: true });

    // Keyboard support: pressing 'E' will trigger pickup/place at the current cursor ray
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
// A glowing target area where items can be placed
// ─────────────────────────────────────────────
AFRAME.registerComponent('drop-zone', {
  schema: {},

  init: function () {
    this.filled = false;
    this.zoneType = this.el.getAttribute('zone-type');

    // Pulse animation for zone visibility
    this.el.setAttribute('animation__pulse', {
      property: 'components.drop-zone.emissiveIntensity',
      from: 0.3,
      to: 0.7,
      dur: 1200,
      dir: 'alternate',
      loop: true,
      easing: 'easeInOutSine',
    });

    // Hover
    // When hovering over a zone while holding an item, give visual feedback
    this.enterZone = (e) => {
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

    this.leaveZone = (e) => {
      if (this.filled) return;
      const visual = this.el.querySelector('.zone-visual');
      if (visual) {
        // Reset to gentle pastel by zone type
        const zoneColors = {
          croissant:  '#ffb830', pastry: '#ff60b0', bread: '#e08820', dish: '#60c0ff', decoration: '#ff60b0'
        };
        visual.setAttribute('material', 'emissive', zoneColors[this.zoneType] || '#ffffff');
        visual.setAttribute('material', 'emissiveIntensity', 0.4);
        visual.setAttribute('material', 'opacity', 0.5);
      }
    };

    // Click on zone attempts a placement
    this.clickZone = (e) => {
      if (this.filled) return;
      e.stopPropagation();
      window.bakeryGame.tryPlace(this.el);
    };

    this.el.addEventListener('mouseenter', this.enterZone);
    this.el.addEventListener('mouseleave', this.leaveZone);
    this.el.addEventListener('click', this.clickZone);
  },

  // Called when zone is filled
  setFilled: function () {
    this.filled = true;
    const visual = this.el.querySelector('.zone-visual');
    if (visual) {
      visual.setAttribute('material', 'color', '#aaffcc');
      visual.setAttribute('material', 'emissive', '#00ff88');
      visual.setAttribute('material', 'emissiveIntensity', 0.6);
      visual.setAttribute('material', 'opacity', 0.4);
    }
    // Gentle scale pulse to confirm
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
    // Remove listeners
    this.el.removeEventListener('mouseenter', this.enterZone);
    this.el.removeEventListener('mouseleave', this.leaveZone);
    this.el.removeEventListener('click', this.clickZone);
  }
});
