/**
 * 🍰 Kawaii Bakery — VR Support (v4 — proximity grab + dedup)
 * vr.js
 *
 * What changed vs v3 (the version that couldn't grab):
 *
 *  1. PROXIMITY GRABBING. Grip now grabs the nearest .interactable within
 *     reach of the controller (GRAB_RADIUS), with the laser raycast kept as
 *     a fallback for grabbing at a distance. Previously grabbing ONLY worked
 *     if the laser happened to intersect the item at the exact moment grip
 *     was squeezed — which almost never happens when you reach for an object
 *     naturally in a headset.
 *
 *  2. PROXIMITY SHELF SNAP ON RELEASE. Releasing grip now checks the drop
 *     zone nearest to the ITEM (not the laser). If a zone is within
 *     SNAP_RADIUS, the game attempts placement (correct type → snaps in,
 *     wrong type → error flash + item drops with physics). Otherwise the
 *     item is released as a dynamic body and falls/throws realistically.
 *
 *  3. INPUT DE-DUPLICATION. On Quest, laser-controls (via
 *     oculus-touch-controls) already emits gripdown/gripup/triggerdown.
 *     xr-gamepad previously emitted the same events again from raw gamepad
 *     polling, causing double grabs and broken state. xr-gamepad now goes
 *     quiet for any button the native component already reported, and only
 *     acts as a fallback for controllers whose profile A-Frame can't map
 *     (e.g. some Quest 3 runtimes).
 *
 *  4. Both hands supported identically (vr-grab on both controllers).
 */

var VR_GRAB_RADIUS = 0.38;  // metres — how close the controller must be to grab
var VR_SNAP_RADIUS = 0.45;  // metres — how close an item must be to a zone to snap

/* ─────────────────────────────────────────────
 * Helpers
 * ───────────────────────────────────────────── */
function vrNearestByClass(className, worldPos, maxDist, filterFn) {
  var els = document.querySelectorAll('.' + className);
  var best = null, bestD = maxDist;
  var p = new THREE.Vector3();
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    if (!el.object3D) continue;
    if (filterFn && !filterFn(el)) continue;
    el.object3D.getWorldPosition(p);
    var d = p.distanceTo(worldPos);
    if (d < bestD) { bestD = d; best = el; }
  }
  return best;
}

/* ─────────────────────────────────────────────
 * XR-GAMEPAD — WebXR gamepad polling FALLBACK
 *
 * Only emits gripdown/gripup/triggerdown/triggerup if the native
 * tracked-controls path did NOT already emit them (dedup via timestamp
 * flags set by listeners below). Thumbstick events are always emitted
 * because A-Frame's axismove format differs and our locomotion/snap-turn
 * components listen for our normalized 'thumbstickmoved'.
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('xr-gamepad', {
  schema: { hand: { type: 'string', default: 'left' } },

  init: function () {
    this.gripPressed = false;
    this.triggerPressed = false;
    this.lastX = 0;
    this.lastY = 0;
    this._logged = false;
    this._nativeGrip = false;    // set when oculus-touch-controls handles grip
    this._nativeTrigger = false;

    var self = this;

    // If the native controller component fires these, it owns the buttons —
    // xr-gamepad stops emitting duplicates permanently.
    this.el.addEventListener('gripdown', function (e) {
      if (!e.detail || e.detail._xrgp !== true) self._nativeGrip = true;
    });
    this.el.addEventListener('triggerdown', function (e) {
      if (!e.detail || e.detail._xrgp !== true) self._nativeTrigger = true;
    });

    // Re-apply raycaster selector after laser-controls initializes (it can
    // override raycaster props during setup).
    this.el.addEventListener('controllerconnected', function () {
      setTimeout(function () {
        self.el.setAttribute('raycaster', 'objects', '.interactable, .drop-zone');
      }, 100);
    });
  },

  tick: function () {
    var renderer = this.el.sceneEl.renderer;
    if (!renderer || !renderer.xr || !renderer.xr.isPresenting) return;
    var session = renderer.xr.getSession();
    if (!session) return;

    var source = null;
    for (var i = 0; i < session.inputSources.length; i++) {
      if (session.inputSources[i].handedness === this.data.hand) {
        source = session.inputSources[i];
        break;
      }
    }
    if (!source || !source.gamepad) return;
    var gp = source.gamepad;

    if (!this._logged) {
      this._logged = true;
      console.log('[xr-gamepad] ' + this.data.hand + ' — axes:' + gp.axes.length +
        ' buttons:' + gp.buttons.length + ' profiles:', source.profiles);
    }

    // Thumbstick — Quest reports at [2,3] (xr-standard) or [0,1]; the unused
    // pair reads 0, so summing works for both layouts.
    var axisX = (gp.axes[0] || 0) + (gp.axes.length > 2 ? (gp.axes[2] || 0) : 0);
    var axisY = (gp.axes[1] || 0) + (gp.axes.length > 3 ? (gp.axes[3] || 0) : 0);
    if (axisX !== this.lastX || axisY !== this.lastY) {
      this.lastX = axisX; this.lastY = axisY;
      this.el.emit('thumbstickmoved', { x: axisX, y: axisY }, false);
    }

    // Grip (xr-standard button 1) — fallback only if native path is silent.
    var gripBtn = gp.buttons[1];
    if (gripBtn && !this._nativeGrip) {
      if (gripBtn.pressed && !this.gripPressed) {
        this.gripPressed = true;
        this.el.emit('gripdown', { _xrgp: true }, false);
      } else if (!gripBtn.pressed && this.gripPressed) {
        this.gripPressed = false;
        this.el.emit('gripup', { _xrgp: true }, false);
      }
    }

    // Trigger (button 0) — fallback only.
    var trigBtn = gp.buttons[0];
    if (trigBtn && !this._nativeTrigger) {
      if (trigBtn.pressed && !this.triggerPressed) {
        this.triggerPressed = true;
        this.el.emit('triggerdown', { _xrgp: true }, false);
        this._clickTarget();
      } else if (!trigBtn.pressed && this.triggerPressed) {
        this.triggerPressed = false;
        this.el.emit('triggerup', { _xrgp: true }, false);
      }
    }
  },

  // Fallback trigger→click on the raycaster's current target.
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
    speed:    { type: 'number', default: 2.2 },
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
    this._up    = new THREE.Vector3(0, 1, 0);
  },

  tick: function (time, delta) {
    if (!this.axisX && !this.axisY) return;
    if (!this.rig || !this.head) return;
    if (!this.el.sceneEl.is('vr-mode')) return;

    var dt = Math.min(delta, 50) / 1000;

    this.head.object3D.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    this._fwd.multiplyScalar(-1).normalize();
    this._right.crossVectors(this._fwd, this._up).normalize();

    this._move.set(0, 0, 0)
      .addScaledVector(this._fwd,  -this.axisY)
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
      var dir = x > 0 ? -1 : 1;
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
 * GRIP GRAB + PROXIMITY SNAP + THROW
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('vr-grab', {
  init: function () {
    this.grabbing = false;
    this._ctrlPos = new THREE.Vector3();
    this._itemPos = new THREE.Vector3();

    this.onGripDown = function () {
      if (this.grabbing) return; // dedup: native + fallback events
      var game = window.bakeryGame;
      if (!game) return;

      // 1) Proximity: nearest grabbable item within reach of the hand.
      this.el.object3D.getWorldPosition(this._ctrlPos);
      var target = vrNearestByClass('interactable', this._ctrlPos, VR_GRAB_RADIUS,
        function (el) {
          var pc = el.components && el.components.pickupable;
          return !(pc && pc.isPlaced);
        });

      // 2) Fallback: whatever the laser is pointing at.
      if (!target) target = this.raycastTarget('interactable');

      if (target) {
        game.pickUpItem(target, this.el);
        this.grabbing = true;
      }
    }.bind(this);

    this.onGripUp = function () {
      if (!this.grabbing) return; // dedup + ignore if this hand isn't holding
      this.grabbing = false;
      var game = window.bakeryGame;
      if (!game || !game.heldItem || game.holder !== this.el) return;

      // 1) Zone nearest to the ITEM (natural "hover over shelf and let go").
      game.heldItem.object3D.getWorldPosition(this._itemPos);
      var zone = vrNearestByClass('drop-zone', this._itemPos, VR_SNAP_RADIUS,
        function (el) {
          var dz = el.components && el.components['drop-zone'];
          return !(dz && dz.filled);
        });

      // 2) Fallback: zone under the laser.
      if (!zone) zone = this.raycastTarget('drop-zone');

      if (zone) {
        game.tryPlace(zone);
        if (!game.heldItem) return; // placed successfully — done
      }

      // Otherwise (or wrong zone): drop where released, with physics + throw.
      game.releaseHeldWithPhysics();
    }.bind(this);

    this.el.addEventListener('gripdown', this.onGripDown);
    this.el.addEventListener('gripup', this.onGripUp);
  },

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
      if (window.bakeryAudio) window.bakeryAudio.start();
      console.log('[vr.js] Entered VR — controllers active');
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
