/**
 * 🍰 Kawaii Bakery — VR Support (v6 — PURPLE technique only)
 * vr.js
 *
 * The grab-test proved the PURPLE method works on this headset:
 *   - controller pose read directly from the raw WebXR frame (gripSpace)
 *   - brute-force gamepad polling: ANY pressed button = grab
 *   - proximity: grabs the nearest grabbable within reach of the hand
 *   - release all buttons = release
 *
 * This file implements ONLY that. Removed entirely: laser-controls,
 * raycasters on the hands, A-Frame button events, raw squeeze/select
 * handlers, super-hands, gaze grabbing in VR, the audio-start panel.
 *
 * Components:
 *   raw-pose             — drives each hand entity from the XR frame and
 *                          emits normalized thumbstick events
 *   purple-grab (scene)  — the any-button poll → grab/carry/release,
 *                          with shelf snap + physics drop via game.js
 *   thumbstick-locomotion / snap-turn — unchanged movement
 *   vr-mode-manager      — hides the desktop reticle while in VR
 */

var VR_GRAB_RADIUS = 0.60;  // metres — hand-to-item grab reach
var VR_SNAP_RADIUS = 0.45;  // metres — item-to-zone snap distance on release

/* ── shared helper ─────────────────────────────────────────────── */
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

function vrHandEntity(handedness) {
  return document.querySelector(handedness === 'left' ? '#leftHand' : '#rightHand');
}

/* ─────────────────────────────────────────────
 * RAW-POSE — entity transform straight from the XR frame,
 * plus normalized thumbstick events for locomotion / snap-turn.
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('raw-pose', {
  schema: { hand: { type: 'string', default: 'left' } },

  init: function () {
    this._q = new THREE.Quaternion();
    this._on = false;
    this.lastX = 0;
    this.lastY = 0;
  },

  tick: function () {
    var sceneEl = this.el.sceneEl;
    var renderer = sceneEl.renderer;
    if (!renderer || !renderer.xr || !renderer.xr.isPresenting) return;
    var session = renderer.xr.getSession();
    var frame = sceneEl.frame;
    var ref = renderer.xr.getReferenceSpace();
    if (!session || !frame || !ref) return;

    for (var i = 0; i < session.inputSources.length; i++) {
      var s = session.inputSources[i];
      if (s.handedness !== this.data.hand) continue;

      // Pose
      if (s.gripSpace) {
        var pose = frame.getPose(s.gripSpace, ref);
        if (pose) {
          var p = pose.transform.position, o = pose.transform.orientation;
          this.el.object3D.position.set(p.x, p.y, p.z);
          this._q.set(o.x, o.y, o.z, o.w);
          this.el.object3D.quaternion.copy(this._q);
          if (!this._on) {
            this._on = true;
            console.log('[vr.js] ' + this.data.hand + ' pose tracking OK');
          }
        }
      }

      // Thumbstick (xr-standard: axes [2,3]; some layouts [0,1] — the
      // unused pair reads 0 so summing handles both)
      if (s.gamepad) {
        var gp = s.gamepad;
        var x = (gp.axes[0] || 0) + (gp.axes.length > 2 ? (gp.axes[2] || 0) : 0);
        var y = (gp.axes[1] || 0) + (gp.axes.length > 3 ? (gp.axes[3] || 0) : 0);
        if (x !== this.lastX || y !== this.lastY) {
          this.lastX = x; this.lastY = y;
          this.el.emit('thumbstickmoved', { x: x, y: y }, false);
        }
      }
      return;
    }
  },
});

/* ─────────────────────────────────────────────
 * PURPLE-GRAB (on <a-scene>) — the winning technique.
 *
 * Every tick, for each hand: if ANY gamepad button just became pressed and
 * the hand is near a grabbable item → game.pickUpItem (item follows the
 * hand via game.js's tick). When ALL buttons release → snap to the nearest
 * open drop zone within reach of the ITEM, else drop with physics/throw.
 *
 * NOTE: buttons include grip, trigger, A/B/X/Y and thumbstick-click.
 * Thumbstick TILT (movement/turning) is an axis, not a button, so walking
 * while carrying works fine.
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('purple-grab', {
  init: function () {
    this._was  = { left: false, right: false };
    this._held = { left: null,  right: null  };
    this._p = new THREE.Vector3();
  },

  tick: function () {
    var sceneEl = this.el;
    var renderer = sceneEl.renderer;
    if (!renderer || !renderer.xr || !renderer.xr.isPresenting) return;
    var session = renderer.xr.getSession();
    if (!session) return;
    var game = window.bakeryGame;
    if (!game) return;

    for (var i = 0; i < session.inputSources.length; i++) {
      var s = session.inputSources[i];
      if (!s.gamepad || !s.handedness || s.handedness === 'none') continue;
      var hand = s.handedness;
      var ent = vrHandEntity(hand);
      if (!ent) continue;

      // ANY button pressed?
      var pressed = false;
      for (var b = 0; b < s.gamepad.buttons.length; b++) {
        if (s.gamepad.buttons[b].pressed) { pressed = true; break; }
      }

      if (pressed && !this._was[hand]) {
        // Rising edge → try to grab the nearest free item
        ent.object3D.getWorldPosition(this._p);
        var target = vrNearestByClass('interactable', this._p, VR_GRAB_RADIUS,
          function (el) {
            var pc = el.components && el.components.pickupable;
            return !(pc && pc.isPlaced);
          });
        if (target && game.heldItem !== target) {
          game.pickUpItem(target, ent);
          this._held[hand] = target;
        }
      } else if (!pressed && this._was[hand] && this._held[hand]) {
        // Falling edge → place or drop
        var item = this._held[hand];
        this._held[hand] = null;
        if (game.heldItem === item && game.holder === ent) {
          item.object3D.getWorldPosition(this._p);
          var zone = vrNearestByClass('drop-zone', this._p, VR_SNAP_RADIUS,
            function (el) {
              var dz = el.components && el.components['drop-zone'];
              return !(dz && dz.filled);
            });
          if (zone) {
            game.tryPlace(zone);
          }
          if (game.heldItem === item) {
            game.releaseHeldWithPhysics();
          }
        }
      }

      this._was[hand] = pressed;
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
 * DESKTOP ↔ VR MODE MANAGER (on <a-scene>)
 * Hides the desktop reticle in VR (no lasers exist anymore).
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
      console.log('[vr.js] Entered VR — purple grab active');
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
