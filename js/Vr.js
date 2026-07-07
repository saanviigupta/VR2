/**
 * 🍰 Kawaii Bakery — VR Support (v3 — laser-controls + xr-gamepad)
 * vr.js
 *
 * Architecture:
 *  - laser-controls     : A-Frame's built-in controller handling. Provides
 *                          pose tracking, controller model, visible laser,
 *                          and trigger→click on intersected entities.
 *  - xr-gamepad         : Lightweight WebXR gamepad poller. Reads thumbstick
 *                          axes and grip/trigger buttons directly from
 *                          XRInputSource.gamepad each frame, emitting named
 *                          events (thumbstickmoved, gripdown, gripup, etc.)
 *                          that our locomotion/grab components listen for.
 *                          This ensures input works even if laser-controls
 *                          can't map Quest 3's controller profile to a
 *                          specific named component like oculus-touch-controls.
 *  - thumbstick-locomotion : smooth movement with LEFT joystick.
 *  - snap-turn           : RIGHT joystick 45° snap turn.
 *  - vr-grab             : GRIP button grab + throw.
 *  - vr-mode-manager     : toggles desktop cursor on/off when entering/exiting VR.
 *
 * Items and drop-zones have invisible raycast-hit geometry on their parent
 * entities (.interactable / .drop-zone) so the raycaster can target them
 * directly and cursor/laser events fire on the correct entity.
 */

/* ─────────────────────────────────────────────
 * XR-GAMEPAD — Direct WebXR gamepad polling
 *
 * Emits: thumbstickmoved, gripdown, gripup, triggerdown, triggerup
 * on the entity each frame when button/axis state changes.
 * Works alongside laser-controls (which handles pose + model + click).
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('xr-gamepad', {
  schema: {
    hand: { type: 'string', default: 'left' },
  },

  init: function () {
    this.gripPressed    = false;
    this.triggerPressed = false;
    this.lastX = 0;
    this.lastY = 0;
    this._logged = false; // one-time debug log

    // Ensure raycaster objects selector survives laser-controls init
    // (laser-controls may override raycaster properties during its setup).
    var self = this;
    this.el.addEventListener('controllerconnected', function () {
      setTimeout(function () {
        self.el.setAttribute('raycaster', 'objects', '.interactable, .drop-zone');
        console.log('[xr-gamepad] raycaster objects re-applied for ' + self.data.hand);
      }, 100);
    });

    console.log('[xr-gamepad] component initialized for hand: ' + this.data.hand);
  },

  tick: function () {
    var renderer = this.el.sceneEl.renderer;
    if (!renderer || !renderer.xr || !renderer.xr.isPresenting) return;

    var session = renderer.xr.getSession();
    if (!session) return;

    // Find input source matching our hand
    var source = null;
    var inputSources = session.inputSources;
    for (var i = 0; i < inputSources.length; i++) {
      if (inputSources[i].handedness === this.data.hand) {
        source = inputSources[i];
        break;
      }
    }
    if (!source || !source.gamepad) return;

    var gp = source.gamepad;

    // One-time debug log to show gamepad layout
    if (!this._logged) {
      this._logged = true;
      console.log('[xr-gamepad] ' + this.data.hand + ' connected — axes:', gp.axes.length,
        'buttons:', gp.buttons.length, 'profiles:', source.profiles);
    }

    // ── Thumbstick axes ─────────────────────────────────────────
    // Quest 3 may report thumbstick at [0,1] or [2,3] depending on runtime.
    // Sum both pairs — the unused pair is always 0, so this works either way.
    var axisX = (gp.axes[0] || 0) + (gp.axes.length > 2 ? (gp.axes[2] || 0) : 0);
    var axisY = (gp.axes[1] || 0) + (gp.axes.length > 3 ? (gp.axes[3] || 0) : 0);
    if (axisX !== this.lastX || axisY !== this.lastY) {
      this.lastX = axisX;
      this.lastY = axisY;
      this.el.emit('thumbstickmoved', { x: axisX, y: axisY }, false);
    }

    // ── Grip / Squeeze button ────────────────────────────────────
    // Quest Touch: buttons[1] = grip/squeeze
    var gripBtn = gp.buttons[1];
    if (gripBtn) {
      if (gripBtn.pressed && !this.gripPressed) {
        this.gripPressed = true;
        this.el.emit('gripdown', {}, false);
      } else if (!gripBtn.pressed && this.gripPressed) {
        this.gripPressed = false;
        this.el.emit('gripup', {}, false);
      }
    }

    // ── Trigger button (index 0) ────────────────────────────────
    var trigBtn = gp.buttons[0];
    if (trigBtn) {
      if (trigBtn.pressed && !this.triggerPressed) {
        this.triggerPressed = true;
        this.el.emit('triggerdown', {}, false);
        // Directly fire click on the raycaster's current target (backup for
        // cursor component in case laser-controls conflicts with it).
        this._clickTarget();
      } else if (!trigBtn.pressed && this.triggerPressed) {
        this.triggerPressed = false;
        this.el.emit('triggerup', {}, false);
      }
    }
  },

  // Fire 'click' on the first intersected .interactable / .drop-zone entity
  _clickTarget: function () {
    var rc = this.el.components.raycaster;
    if (!rc) return;
    var els = rc.intersectedEls || [];
    for (var i = 0; i < els.length; i++) {
      var node = els[i];
      while (node && node !== this.el.sceneEl) {
        if (node.classList &&
            (node.classList.contains('interactable') || node.classList.contains('drop-zone'))) {
          node.emit('click', { cursorEl: this.el, intersection: null }, false);
          return;
        }
        node = node.parentElement;
      }
    }
  },
});

/* ─────────────────────────────────────────────
 * SMOOTH LOCOMOTION (left thumbstick)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('thumbstick-locomotion', {
  schema: {
    speed:    { type: 'number', default: 2.2 },  // metres/sec
    deadzone: { type: 'number', default: 0.15 },
  },

  init: function () {
    this.axisX = 0;
    this.axisY = 0;
    this.rig  = document.querySelector('#player');
    this.head = document.querySelector('#head');

    this.onThumbstick = function (evt) {
      var x = evt.detail.x || 0;
      var y = evt.detail.y || 0;
      this.axisX = Math.abs(x) < this.data.deadzone ? 0 : x;
      this.axisY = Math.abs(y) < this.data.deadzone ? 0 : y;
    }.bind(this);
    this.el.addEventListener('thumbstickmoved', this.onThumbstick);

    this._fwd   = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move  = new THREE.Vector3();
  },

  tick: function (time, delta) {
    if (!this.axisX && !this.axisY) return;
    if (!this.rig || !this.head) return;
    if (!this.el.sceneEl.is('vr-mode')) return;

    var dt = Math.min(delta, 50) / 1000;

    // Head-relative movement, flattened to ground plane
    this.head.object3D.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    this._fwd.multiplyScalar(-1).normalize();
    this._right.crossVectors(this._fwd, new THREE.Vector3(0, 1, 0)).normalize();

    this._move.set(0, 0, 0)
      .addScaledVector(this._fwd,  -this.axisY)   // stick up (y=-1) => forward
      .addScaledVector(this._right, this.axisX);

    if (this._move.lengthSq() > 1) this._move.normalize();
    this._move.multiplyScalar(this.data.speed * dt);

    this.rig.object3D.position.add(this._move);
  },

  remove: function () {
    this.el.removeEventListener('thumbstickmoved', this.onThumbstick);
  },
});

/* ─────────────────────────────────────────────
 * SNAP TURN (right thumbstick, 45° increments)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('snap-turn', {
  schema: {
    degrees:   { type: 'number', default: 45 },
    threshold: { type: 'number', default: 0.75 },
    resetAt:   { type: 'number', default: 0.35 },
  },

  init: function () {
    this.armed = true;
    this.rig  = document.querySelector('#player');
    this.head = document.querySelector('#head');

    this.onThumbstick = function (evt) {
      var x = evt.detail.x || 0;
      if (Math.abs(x) < this.data.resetAt) { this.armed = true; return; }
      if (!this.armed || Math.abs(x) < this.data.threshold) return;
      this.armed = false;
      var dir = x > 0 ? -1 : 1; // stick right = clockwise
      this.turn(dir * this.data.degrees);
    }.bind(this);
    this.el.addEventListener('thumbstickmoved', this.onThumbstick);
  },

  turn: function (degrees) {
    if (!this.rig || !this.head) return;
    var rad = THREE.MathUtils.degToRad(degrees);
    var headWorld = new THREE.Vector3();
    this.head.object3D.getWorldPosition(headWorld);

    var rigObj = this.rig.object3D;
    rigObj.rotation.y += rad;

    // Compensate translation so the head stays in place (pivot around head)
    var newHeadWorld = new THREE.Vector3();
    rigObj.updateMatrixWorld(true);
    this.head.object3D.getWorldPosition(newHeadWorld);
    rigObj.position.add(headWorld.sub(newHeadWorld));
  },

  remove: function () {
    this.el.removeEventListener('thumbstickmoved', this.onThumbstick);
  },
});

/* ─────────────────────────────────────────────
 * GRIP GRAB + THROW
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('vr-grab', {
  init: function () {
    this.grabbing = false;

    this.onGripDown = function () {
      var target = this.raycastTarget('interactable');
      if (target && window.bakeryGame) {
        window.bakeryGame.pickUpItem(target, this.el);
        this.grabbing = true;
      }
    }.bind(this);

    this.onGripUp = function () {
      if (!this.grabbing) return;
      this.grabbing = false;
      var game = window.bakeryGame;
      if (!game || !game.heldItem) return;

      var zone = this.raycastTarget('drop-zone');
      if (zone) {
        game.tryPlace(zone);
        if (!game.heldItem) return; // placed successfully
      }
      game.releaseHeldWithPhysics();
    }.bind(this);

    this.el.addEventListener('gripdown', this.onGripDown);
    this.el.addEventListener('gripup', this.onGripUp);
  },

  // Find the closest ancestor with the given class among the controller's
  // current raycaster intersections.
  raycastTarget: function (className) {
    var rc = this.el.components.raycaster;
    if (!rc) return null;
    var els = rc.intersectedEls || [];
    for (var i = 0; i < els.length; i++) {
      var node = els[i];
      while (node && node !== this.el.sceneEl) {
        if (node.classList && node.classList.contains(className)) return node;
        node = node.parentElement;
      }
    }
    return null;
  },

  remove: function () {
    this.el.removeEventListener('gripdown', this.onGripDown);
    this.el.removeEventListener('gripup', this.onGripUp);
  },
});

/* ─────────────────────────────────────────────
 * DESKTOP ↔ VR MODE MANAGER (on <a-scene>)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('vr-mode-manager', {
  init: function () {
    var scene = this.el;

    scene.addEventListener('enter-vr', function () {
      var cursor = document.querySelector('#cursor');
      if (cursor) {
        cursor.setAttribute('visible', 'false');
        cursor.setAttribute('raycaster', 'enabled', false);
      }
      document.body.classList.add('in-vr');
      console.log('[vr.js] Entered VR — laser-controls active, desktop cursor disabled');
    });

    scene.addEventListener('exit-vr', function () {
      var cursor = document.querySelector('#cursor');
      if (cursor) {
        cursor.setAttribute('visible', 'true');
        cursor.setAttribute('raycaster', 'enabled', true);
      }
      document.body.classList.remove('in-vr');
      console.log('[vr.js] Exited VR — desktop mode restored');
    });
  },
});
