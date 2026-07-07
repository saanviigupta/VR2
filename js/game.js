/**
 * 🍰 Kawaii Bakery — Game Logic (FIXED v5 — VR)
 * game.js
 *
 * Changes from v3/v4:
 *  - pickUpItem(el, holderEl): held items can follow a VR controller instead
 *    of the camera (holderEl = the laser-controls entity that grabbed it).
 *  - Held-item velocity is tracked every frame so releasing GRIP throws the
 *    item with realistic momentum (releaseHeldWithPhysics()).
 *  - releaseHeldWithPhysics(): converts the item's ammo-body to DYNAMIC so it
 *    falls, collides with the floor/furniture, and responds to gravity.
 *  - Emissive helpers skip flat-shader materials (console-warning fix).
 *  - Gaze hover-highlight loop and the "click empty space to return item"
 *    behaviour are desktop-only; in VR the controllers handle everything.
 *
 * All original desktop gameplay is preserved.
 */

class BakeryGame {
  constructor() {
    this.heldItem    = null;
    this.holder      = null;   // entity the held item follows (camera or controller)
    this.totalItems  = window.BAKERY_TOTAL_ITEMS || 0;
    this.placedItems = 0;

    this.holdOffsetCamera     = { x: 0, y: -0.28, z: -0.75 };
    this.holdOffsetController = { x: 0, y: 0.02,  z: -0.30 };

    this.camera = document.querySelector('[camera]');
    this.player = document.querySelector('#player');
    this.scene  = document.querySelector('a-scene');

    // Recent world positions of the held item → throw velocity
    this._velSamples = [];

    if (this.totalItems === 0) {
      const checkTotal = setInterval(() => {
        if (window.BAKERY_TOTAL_ITEMS) {
          this.totalItems = window.BAKERY_TOTAL_ITEMS;
          clearInterval(checkTotal);
          this.updateHUD();
        }
      }, 100);
    }

    this.updateHUD();

    this.tick = this.tick.bind(this);
    this.running = true;
    requestAnimationFrame(this.tick);

    // Desktop only: click empty space while holding = return item.
    window.addEventListener('click', () => {
      if (this.scene && this.scene.is('vr-mode')) return;
      if (this.heldItem) {
        this.returnToOriginalSpot(this.heldItem);
      }
    });

    // Desktop only: keyboard 'E' / Enter — pick or place at camera centre
    window.addEventListener('keydown', (ev) => {
      const key = ev.key || ev.code;
      if (key === 'e' || key === 'E' || key === 'Enter') {
        this.raycastAction();
      }
    }, false);
  }

  // ─── Emissive helper (skips flat shader — no emissive support) ──
  _safeEmissive(el, color, intensity) {
    try {
      const mat = el.getAttribute && el.getAttribute('material');
      if (!mat) return;
      if (mat.shader && mat.shader === 'flat') return;
      el.setAttribute('material', 'emissive', color);
      el.setAttribute('material', 'emissiveIntensity', intensity);
    } catch (e) {}
  }

  _setEmissiveDeep(el, color, intensity) {
    this._safeEmissive(el, color, intensity);
    el.querySelectorAll('*').forEach((ch) => this._safeEmissive(ch, color, intensity));
  }

  // ─── Physics state transitions ──────────────────────────────────
  _setPhysicsKinematic(el) {
    try {
      if (el.components && el.components['ammo-body']) {
        el.setAttribute('ammo-body', 'type', 'kinematic');
      }
    } catch (e) {}
  }

  _setPhysicsStatic(el) {
    try {
      if (el.components && el.components['ammo-body']) {
        el.setAttribute('ammo-body', 'type', 'static');
      }
    } catch (e) {}
  }

  _setPhysicsDynamic(el) {
    try {
      if (el.components && el.components['ammo-body']) {
        el.setAttribute('ammo-body', 'type', 'dynamic');
        el.setAttribute('ammo-body', 'mass', 1);
      }
    } catch (e) {}
  }

  // ─── Raycast from camera (desktop gaze) ─────────────────────────
  findCameraTarget(maxDist = 6) {
    if (!this.camera) return null;
    const camObj = this.camera.object3D;
    const origin = new THREE.Vector3();
    camObj.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    camObj.getWorldDirection(dir);
    const ray = new THREE.Raycaster(origin, dir, 0, maxDist);
    const sceneObj = this.scene.object3D;
    const intersects = ray.intersectObject(sceneObj, true);
    if (!intersects || !intersects.length) return null;
    for (const hit of intersects) {
      if (!hit || !hit.object) continue;
      let node = hit.object.el;
      while (node && node !== this.scene) {
        const cls = node.getAttribute && node.getAttribute('class');
        if (cls && (cls.includes('interactable') || cls.includes('drop-zone'))) return node;
        node = node.parentElement;
      }
    }
    return null;
  }

  highlightElement(el) {
    if (!el) return;
    try {
      if (el.components && el.components.pickupable && el.components.pickupable.isPlaced) return;
      this._setEmissiveDeep(el, '#ffaae0', 0.45);
      el.setAttribute('animation__hover', { property: 'scale', from: '1 1 1', to: '1.07 1.07 1.07', dur: 150, easing: 'easeOutQuad' });
    } catch (e) {}
  }

  unhighlightElement(el) {
    if (!el) return;
    try {
      if (el.components && el.components.pickupable && el.components.pickupable.isPlaced) return;
      this._setEmissiveDeep(el, '#000000', 0);
      el.removeAttribute('animation__hover');
      el.setAttribute('scale', '1 1 1');
    } catch (e) {}
  }

  raycastAction() {
    try {
      if (!this.camera) return;
      const camObj = this.camera.object3D;
      const origin = new THREE.Vector3();
      camObj.getWorldPosition(origin);
      const dir = new THREE.Vector3();
      camObj.getWorldDirection(dir);
      const ray = new THREE.Raycaster(origin, dir, 0, 6);
      const sceneObj = this.scene.object3D;
      const intersects = ray.intersectObject(sceneObj, true);
      if (!intersects || !intersects.length) {
        if (this.heldItem) this.returnToOriginalSpot(this.heldItem);
        return;
      }
      for (const hit of intersects) {
        if (!hit || !hit.object) continue;
        let node = hit.object.el;
        while (node && node !== this.scene) {
          const cls = node.getAttribute && node.getAttribute('class');
          if (cls && cls.includes('interactable')) { this.pickUpItem(node); return; }
          if (cls && cls.includes('drop-zone'))    { this.tryPlace(node);   return; }
          node = node.parentElement;
        }
      }
    } catch (e) { console.warn('raycastAction error', e); }
  }

  // ─── PICK UP ───────────────────────────────────────────────────
  // holderEl (optional): a VR controller entity. If omitted, the item
  // follows the camera (desktop behaviour, unchanged).
  pickUpItem(el, holderEl) {
    if (this.heldItem && this.heldItem !== el) {
      this.returnToOriginalSpot(this.heldItem);
    }
    this.heldItem = el;
    this.holder   = holderEl || this.camera;
    this._velSamples.length = 0;

    // Kinematic while in hand — position driven by JS
    this._setPhysicsKinematic(el);

    this._safeEmissive(el, '#ffffaa', 0.45);

    el.removeAttribute('animation__bob');
    el.removeAttribute('animation__return');
    el.removeAttribute('animation__pickup');
    el.setAttribute('animation__pickup', { property: 'scale', from: '1 1 1', to: '1.2 1.2 1.2', dur: 160, easing: 'easeOutQuad' });

    if (!el._orig) {
      el._orig = {
        position: Object.assign({}, el.getAttribute('position')),
        rotation: Object.assign({}, el.getAttribute('rotation')),
      };
    }

    const itemType = el.getAttribute('item-type');
    document.getElementById('holding-indicator').style.display = 'block';
    document.getElementById('holding-name').textContent = this.prettyName(itemType);
  }

  // ─── PLACE ─────────────────────────────────────────────────────
  tryPlace(zoneEl) {
    if (!this.heldItem) return;

    const itemType = this.heldItem.getAttribute('item-type');
    const zoneType = zoneEl.getAttribute('zone-type');

    if (itemType === zoneType) {
      this.placeItemCorrectly(this.heldItem, zoneEl);
    } else {
      const visual = zoneEl.querySelector('.zone-visual');
      if (visual) {
        visual.setAttribute('material', 'color', '#ff8888');
        setTimeout(() => visual.setAttribute('material', 'color', '#ffd0e8'), 450);
      }
    }
  }

  placeItemCorrectly(itemEl, zoneEl) {
    // Use the zone's WORLD position (extra zones are scene children, but this
    // also stays correct if a zone is ever nested).
    const zoneWorld = new THREE.Vector3();
    zoneEl.object3D.getWorldPosition(zoneWorld);

    const pickupComp = itemEl.components && itemEl.components.pickupable;
    if (pickupComp) pickupComp.isPlaced = true;

    itemEl.removeAttribute('animation__snap');
    itemEl.setAttribute('animation__snap', {
      property: 'position',
      to: `${zoneWorld.x} ${zoneWorld.y + 0.10} ${zoneWorld.z}`,
      dur: 400,
      easing: 'easeOutBack',
    });
    itemEl.setAttribute('animation__scaleback', { property: 'scale', to: '1 1 1', dur: 220, easing: 'easeOutQuad' });

    this._safeEmissive(itemEl, '#ffffff', 0.12);

    // Freeze physics — item is now static at its placed location
    this._setPhysicsStatic(itemEl);

    if (zoneEl.components['drop-zone']) zoneEl.components['drop-zone'].setFilled();

    this.heldItem = null;
    this.holder   = null;
    document.getElementById('holding-indicator').style.display = 'none';

    this.spawnSparkles(itemEl);
    this.placedItems++;
    this.updateHUD();

    if (this.placedItems >= this.totalItems) {
      setTimeout(() => this.showCompletion(), 700);
    }
  }

  // ─── RELEASE AS DYNAMIC BODY (VR grip release / throw) ─────────
  releaseHeldWithPhysics() {
    const el = this.heldItem;
    if (!el) return;

    this._setEmissiveDeep(el, '#000000', 0);
    el.removeAttribute('animation__pickup');
    el.removeAttribute('animation__bob');
    el.setAttribute('scale', '1 1 1');

    // Compute throw velocity from recent samples (world units / second)
    const vel = this._computeHeldVelocity();

    this.heldItem = null;
    this.holder   = null;
    document.getElementById('holding-indicator').style.display = 'none';

    // Switch to dynamic so gravity + collisions take over…
    this._setPhysicsDynamic(el);

    // …then apply the throw impulse once the body has re-initialized.
    setTimeout(() => {
      try {
        if (el.body && typeof Ammo !== 'undefined') {
          const v = new Ammo.btVector3(vel.x, vel.y, vel.z);
          el.body.setLinearVelocity(v);
          el.body.activate(true);
          Ammo.destroy(v);
        }
      } catch (e) { console.warn('throw velocity failed', e); }
    }, 60);
  }

  _computeHeldVelocity() {
    const s = this._velSamples;
    if (s.length < 2) return { x: 0, y: 0, z: 0 };
    const a = s[0];
    const b = s[s.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return { x: 0, y: 0, z: 0 };
    const scale = 1.0; // 1:1 hand-to-item velocity
    return {
      x: ((b.p.x - a.p.x) / dt) * scale,
      y: ((b.p.y - a.p.y) / dt) * scale,
      z: ((b.p.z - a.p.z) / dt) * scale,
    };
  }

  returnToOriginalSpot(el) {
    if (!el) return;
    this._setEmissiveDeep(el, '#000000', 0);
    el.removeAttribute('animation__pickup');

    const orig = (el._orig && el._orig.position) ? el._orig.position : el.getAttribute('position');
    const x = orig.x !== undefined ? orig.x : 0;
    const y = orig.y !== undefined ? orig.y : 1;
    const z = orig.z !== undefined ? orig.z : 0;

    el.setAttribute('animation__return', {
      property: 'position',
      to: `${x} ${y} ${z}`,
      dur: 300,
      easing: 'easeOutQuad',
    });

    setTimeout(() => {
      this._setPhysicsKinematic(el);

      el.setAttribute('animation__bob', {
        property: 'position',
        from: `${x} ${y} ${z}`,
        to:   `${x} ${parseFloat(y) + 0.06} ${z}`,
        dur: 2000,
        dir: 'alternate',
        loop: true,
        easing: 'easeInOutSine',
      });
    }, 350);

    this.heldItem = null;
    this.holder   = null;
    document.getElementById('holding-indicator').style.display = 'none';
  }

  // ─── RAF LOOP ──────────────────────────────────────────────────
  tick() {
    const inVR = this.scene && this.scene.is('vr-mode');

    // Gaze hover highlight — desktop only. In VR, laser-controls raycasters
    // fire mouseenter/mouseleave on entities, which pickupable handles.
    if (!inVR) {
      try {
        const curTarget = this.findCameraTarget(6);
        if (curTarget !== this._hoverTarget) {
          if (this._hoverTarget) this.unhighlightElement(this._hoverTarget);
          this._hoverTarget = curTarget;
          if (this._hoverTarget) this.highlightElement(this._hoverTarget);
        }
        const dbg = document.getElementById('debug-target');
        if (dbg) dbg.textContent = this._hoverTarget
          ? (this._hoverTarget.getAttribute('item-type') || this._hoverTarget.id || this._hoverTarget.tagName)
          : 'none';
      } catch (e) {}
    }

    // Move held item in front of its holder (camera OR VR controller)
    if (this.heldItem && (this.holder || this.camera)) {
      const holder = this.holder || this.camera;
      const holdObj = holder.object3D;
      const worldPos  = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      holdObj.getWorldPosition(worldPos);
      holdObj.getWorldQuaternion(worldQuat);

      const off = (holder === this.camera) ? this.holdOffsetCamera : this.holdOffsetController;
      const offset = new THREE.Vector3(off.x, off.y, off.z);
      offset.applyQuaternion(worldQuat);
      worldPos.add(offset);

      // Record for throw-velocity estimation (keep ~120ms of samples)
      const now = performance.now();
      this._velSamples.push({ t: now, p: worldPos.clone() });
      while (this._velSamples.length > 8) this._velSamples.shift();

      const parent = this.heldItem.object3D.parent;
      const localPos = worldPos.clone();
      if (parent) parent.worldToLocal(localPos);
      this.heldItem.object3D.position.copy(localPos);
      this.heldItem.object3D.rotation.y += 0.025;
    }

    if (this.running) requestAnimationFrame(this.tick);
  }

  // ─── HUD ───────────────────────────────────────────────────────
  updateHUD() {
    const total = this.totalItems || 1;
    const pct   = Math.round((this.placedItems / total) * 100);
    document.getElementById('progress-bar').style.width = pct + '%';
    document.getElementById('progress-text').textContent =
      `Items placed: ${this.placedItems} / ${this.totalItems || '?'}`;
  }

  // ─── COMPLETION ────────────────────────────────────────────────
  showCompletion() {
    document.getElementById('completion-screen').style.display = 'flex';
    for (let i = 0; i < 25; i++) {
      setTimeout(() => this.spawnScreenSparkle(), i * 60);
    }
  }

  // ─── SPARKLES ──────────────────────────────────────────────────
  spawnSparkles(itemEl) {
    try {
      const vector = new THREE.Vector3();
      itemEl.object3D.getWorldPosition(vector);
      const camera = this.camera.components.camera.camera;
      vector.project(camera);
      const x = (vector.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-vector.y * 0.5 + 0.5) * window.innerHeight;
      const emojis = ['✨', '🌸', '⭐', '💖'];
      for (let i = 0; i < 6; i++) {
        const s = document.createElement('div');
        s.className = 'sparkle';
        s.textContent = emojis[Math.floor(Math.random() * emojis.length)];
        s.style.left = (x + (Math.random() - 0.5) * 60) + 'px';
        s.style.top  = (y + (Math.random() - 0.5) * 40) + 'px';
        document.getElementById('sparkle-container').appendChild(s);
        setTimeout(() => s.remove(), 1300);
      }
    } catch (e) {}
  }

  spawnScreenSparkle() {
    const emojis = ['✨', '🌸', '⭐', '💖', '🍰', '🥐'];
    const s = document.createElement('div');
    s.className = 'sparkle';
    s.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    s.style.left = Math.random() * window.innerWidth + 'px';
    s.style.top  = (window.innerHeight * (0.5 + Math.random() * 0.5)) + 'px';
    s.style.fontSize = (20 + Math.random() * 24) + 'px';
    document.getElementById('sparkle-container').appendChild(s);
    setTimeout(() => s.remove(), 1300);
  }

  // ─── PRETTY NAMES ──────────────────────────────────────────────
  prettyName(type) {
    const names = {
      croissant:   '🥐 Croissant',
      pastry:      '🍰 Pastry',
      bread:       '🥖 Bread',
      'dirty-dish':'🍽️ Dirty Dish',
      decoration:  '🎀 Decoration',
      cupcake:     '🧁 Cupcake',
      cookie:      '🍪 Cookie',
      donut:       '🍩 Donut',
      macaron:     '🫐 Macaron',
      muffin:      '🧁 Muffin',
      brownie:     '🍫 Brownie',
      fork:        '🍴 Fork',
      spoon:       '🥄 Spoon',
    };
    return names[type] || type;
  }
}

// ─── Reset ────────────────────────────────────────────────────────
function resetGame() { location.reload(); }

// ─── Init ─────────────────────────────────────────────────────────
const sceneEl = document.querySelector('a-scene');
function startGame() { window.bakeryGame = new BakeryGame(); }
if (sceneEl.hasLoaded) { startGame(); }
else { sceneEl.addEventListener('loaded', startGame); }
