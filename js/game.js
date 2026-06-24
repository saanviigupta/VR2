/**
 * 🍰 Kawaii Bakery — Game Logic  (FIXED v3)
 * game.js
 *
 * Physics integration:
 *  - Items spawn as ammo-body="type: kinematic" so the bob animation drives them.
 *  - When picked up, physics is set to kinematic and animation is paused.
 *  - When placed correctly, body becomes static so it rests in place.
 *  - When dropped back (miss), body returns to kinematic + bob resumes.
 *
 * All other behaviour unchanged from the original.
 */

class BakeryGame {
  constructor() {
    this.heldItem    = null;
    this.totalItems  = window.BAKERY_TOTAL_ITEMS || 0;
    this.placedItems = 0;

    this.holdOffset = { x: 0, y: -0.28, z: -0.75 };

    this.camera = document.querySelector('[camera]');
    this.player = document.querySelector('#player');

    // Wait for items.js to finish if needed
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

    // Click anywhere (bubbled) while holding = drop back
    window.addEventListener('click', () => {
      if (this.heldItem) {
        this.returnToOriginalSpot(this.heldItem);
      }
    });

    // Keyboard 'E' / Enter — pick or place at camera centre
    window.addEventListener('keydown', (ev) => {
      const key = ev.key || ev.code;
      if (key === 'e' || key === 'E' || key === 'Enter') {
        this.raycastAction();
      }
    }, false);
  }

  // ─── Helpers for physics state transitions ──────────────────────
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

  // ─── Raycast from camera ────────────────────────────────────────
  findCameraTarget(maxDist = 6) {
    if (!this.camera) return null;
    const camObj = this.camera.object3D;
    const origin = new THREE.Vector3();
    camObj.getWorldPosition(origin);
    const dir = new THREE.Vector3();
    camObj.getWorldDirection(dir);
    const ray = new THREE.Raycaster(origin, dir, 0, maxDist);
    const sceneObj = document.querySelector('a-scene').object3D;
    const intersects = ray.intersectObject(sceneObj, true);
    if (!intersects || !intersects.length) return null;
    for (const hit of intersects) {
      if (!hit || !hit.object) continue;
      let node = hit.object.el;
      while (node && node !== document.querySelector('a-scene')) {
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
      if (el.getAttribute('material')) {
        el.setAttribute('material', 'emissive', '#ffaae0');
        el.setAttribute('material', 'emissiveIntensity', 0.45);
      }
      el.querySelectorAll('*').forEach((ch) => {
        try {
          if (ch.getAttribute('material')) {
            ch.setAttribute('material', 'emissive', '#ffaae0');
            ch.setAttribute('material', 'emissiveIntensity', 0.45);
          }
        } catch (e) {}
      });
      el.setAttribute('animation__hover', { property: 'scale', from: '1 1 1', to: '1.07 1.07 1.07', dur: 150, easing: 'easeOutQuad' });
    } catch (e) {}
  }

  unhighlightElement(el) {
    if (!el) return;
    try {
      if (el.components && el.components.pickupable && el.components.pickupable.isPlaced) return;
      if (el.getAttribute('material')) {
        el.setAttribute('material', 'emissive', '#000000');
        el.setAttribute('material', 'emissiveIntensity', 0);
      }
      el.querySelectorAll('*').forEach((ch) => {
        try {
          if (ch.getAttribute('material')) {
            ch.setAttribute('material', 'emissive', '#000000');
            ch.setAttribute('material', 'emissiveIntensity', 0);
          }
        } catch (e) {}
      });
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
      const sceneObj = document.querySelector('a-scene').object3D;
      const intersects = ray.intersectObject(sceneObj, true);
      if (!intersects || !intersects.length) {
        if (this.heldItem) this.returnToOriginalSpot(this.heldItem);
        return;
      }
      for (const hit of intersects) {
        if (!hit || !hit.object) continue;
        let node = hit.object.el;
        while (node && node !== document.querySelector('a-scene')) {
          const cls = node.getAttribute && node.getAttribute('class');
          if (cls && cls.includes('interactable')) { this.pickUpItem(node); return; }
          if (cls && cls.includes('drop-zone'))    { this.tryPlace(node);   return; }
          node = node.parentElement;
        }
      }
    } catch (e) { console.warn('raycastAction error', e); }
  }

  // ─── PICK UP ───────────────────────────────────────────────────
  pickUpItem(el) {
    if (this.heldItem && this.heldItem !== el) {
      this.returnToOriginalSpot(this.heldItem);
    }
    this.heldItem = el;

    // Pause physics while item is in hand (kinematic = position driven by JS)
    this._setPhysicsKinematic(el);

    try {
      el.setAttribute('material', 'emissive', '#ffffaa');
      el.setAttribute('material', 'emissiveIntensity', 0.45);
    } catch (e) {}

    // Stop idle bob so it doesn't fight with held-position update
    el.removeAttribute('animation__bob');
    el.removeAttribute('animation__pickup');
    el.setAttribute('animation__pickup', { property: 'scale', from: '1 1 1', to: '1.2 1.2 1.2', dur: 160, easing: 'easeOutQuad' });

    el._orig = {
      position: Object.assign({}, el.getAttribute('position')),
      rotation: Object.assign({}, el.getAttribute('rotation')),
    };

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
      // Wrong zone — red flash
      const visual = zoneEl.querySelector('.zone-visual');
      if (visual) {
        visual.setAttribute('material', 'color', '#ff8888');
        setTimeout(() => visual.setAttribute('material', 'color', '#ffd0e8'), 450);
      }
    }
  }

  placeItemCorrectly(itemEl, zoneEl) {
    const zonePos = zoneEl.getAttribute('position');

    const pickupComp = itemEl.components && itemEl.components.pickupable;
    if (pickupComp) pickupComp.isPlaced = true;

    // Snap animation to zone position
    itemEl.removeAttribute('animation__snap');
    itemEl.setAttribute('animation__snap', {
      property: 'position',
      to: `${zonePos.x} ${zonePos.y + 0.10} ${zonePos.z}`,
      dur: 400,
      easing: 'easeOutBack',
    });
    itemEl.setAttribute('animation__scaleback', { property: 'scale', to: '1 1 1', dur: 220, easing: 'easeOutQuad' });

    try {
      itemEl.setAttribute('material', 'emissive', '#ffffff');
      itemEl.setAttribute('material', 'emissiveIntensity', 0.12);
    } catch (e) {}

    // Freeze physics — item is now static at its placed location
    this._setPhysicsStatic(itemEl);

    if (zoneEl.components['drop-zone']) zoneEl.components['drop-zone'].setFilled();

    this.heldItem = null;
    document.getElementById('holding-indicator').style.display = 'none';

    this.spawnSparkles(itemEl);
    this.placedItems++;
    this.updateHUD();

    if (this.placedItems >= this.totalItems) {
      setTimeout(() => this.showCompletion(), 700);
    }
  }

  returnToOriginalSpot(el) {
    if (!el) return;
    try {
      el.setAttribute('material', 'emissive', '#000000');
      el.setAttribute('material', 'emissiveIntensity', 0);
    } catch (e) {}
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

    // Resume kinematic bob after return animation
    setTimeout(() => {
      // Stay kinematic (animation-driven) while bobbing
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
    document.getElementById('holding-indicator').style.display = 'none';
  }

  // ─── RAF LOOP ──────────────────────────────────────────────────
  tick() {
    // Hover highlight
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

    // Move held item in front of camera
    if (this.heldItem && this.camera) {
      const camObj = this.camera.object3D;
      const worldPos  = new THREE.Vector3();
      const worldQuat = new THREE.Quaternion();
      camObj.getWorldPosition(worldPos);
      camObj.getWorldQuaternion(worldQuat);

      const offset = new THREE.Vector3(this.holdOffset.x, this.holdOffset.y, this.holdOffset.z);
      offset.applyQuaternion(worldQuat);
      worldPos.add(offset);

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